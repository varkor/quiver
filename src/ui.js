"use strict";

/// Various parameters.
const CONSTANTS = {
    /// We currently only support 0-cells, 1-cells and 2-cells. This is solely
    /// due to a restriction with tikz-cd, which does not support 3-cells.
    /// This restriction is not technical: it can be lifted in the editor without issue.
    MAXIMUM_CELL_LEVEL: 2,
    /// The width of the dashed grid lines.
    GRID_BORDER_WIDTH: 2,
    /// The padding of the content area of a vertex.
    CONTENT_PADDING: 8,
    /// How much (horizontal and vertical) space (in pixels) in the SVG to give around the arrow
    /// (to account for artefacts around the drawing).
    SVG_PADDING: 6,
    // How much space (in pixels) to leave between adjacent parallel arrows.
    EDGE_OFFSET_DISTANCE: 8,
};

/// Various states for the UI (e.g. whether cells are being rearranged, or connected, etc.).
class UIState {
    constructor() {
        // Used for the CSS class associated with the state. `null` means no class.
        this.name = null;
    }

    /// A placeholder method to clean up any state when a state is left.
    release() {}
}

/// The default state, representing no special action.
UIState.Default = class extends UIState {
    constructor() {
        super();

        this.name = "default";
    }
};
UIState.default = new UIState.Default();

UIState.Modal = class extends UIState {
    constructor() {
        super();

        this.name = "modal";
    }
}

/// Two k-cells are being connected by an (k + 1)-cell.
UIState.Connect = class extends UIState {
    constructor(ui, source, forged_vertex, reconnect = null) {
        super();

        this.name = "connect";

        /// The source of a connection between two cells.
        this.source = source;

        /// The target of a connection between two cells.
        this.target = null;

        /// Whether the source of this connection was created with the start
        /// of the connection itself (i.e. a vertex was created after dragging
        /// from an empty grid cell).
        this.forged_vertex = forged_vertex;

        /// If `reconnect` is not null, then we're reconnecting an existing edge.
        /// In that case, rather than drawing a phantom arrow, we'll actually
        /// reposition the existing edge.
        /// `reconnect` is of the form `{ edge, end }` where `end` is either
        /// `"source"` or `"target"`.
        this.reconnect = reconnect;

        /// The overlay for drawing an edge between the source and the cursor.
        this.overlay = new DOM.Element("div", { class: "edge overlay" })
            .add(new DOM.SVGElement("svg"));
        ui.canvas.add(this.overlay);
    }

    release(ui) {
        this.overlay.remove();
        this.source.element.classList.remove("source");
        if (this.target !== null) {
            this.target.element.classList.remove("target");
        }
        if (this.reconnect !== null) {
            this.reconnect.edge.element.classList.remove("reconnecting");
            this.reconnect.edge.render(ui);
            this.reconnect = null;
        }
    }

    /// Update the overlay with a new cursor position.
    update(ui, offset) {
        // If we're creating a new edge...
        if (this.reconnect === null) {
            // We're drawing the edge again from scratch, so we need to remove all existing
            // elements.
            const svg = this.overlay.query_selector("svg");
            new DOM.Element(svg).clear();
            Edge.draw_and_position_edge(
                ui,
                this.overlay.element,
                svg,
                {
                    offset: this.source.off(ui),
                    size: this.source.size(),
                    is_offset: true,
                    level: this.source.level,
                },
                // Lock on to the target if present, otherwise simply draw the edge
                // to the position of the cursor.
                this.target !== null ? {
                    offset: this.target.off(ui),
                    size: this.target.size(),
                    is_offset: true,
                    level: this.target.level,
                } : {
                    offset,
                    size: Dimensions.zero(),
                    is_offset: false,
                    level: 0,
                },
                Edge.default_options(null, {
                    body: { name: "cell", level: this.source.level + 1 },
                }),
                null,
            );
        } else {
            // We're reconnecting an existing edge.
            this.reconnect.edge.render(ui, offset);
            for (const cell of ui.quiver.transitive_dependencies([this.reconnect.edge], true)) {
                cell.render(ui);
            }
        }
    }

    /// Returns whether the `source` is compatible with the specified `target`.
    /// This first checks that the source is valid at all.
    valid_connection(target) {
        return this.source.level < CONSTANTS.MAXIMUM_CELL_LEVEL &&
            // To allow `valid_connection` to be used to simply check whether the source is valid,
            // we ignore source–target compatibility if `target` is null.
            // We allow cells to be connected even if they do not have the same level. This is
            // because it's often useful when drawing diagrams, even if it may not always be
            // semantically valid.
            (target === null || target.level < CONSTANTS.MAXIMUM_CELL_LEVEL);
    }

    /// Connects the source and target. Note that this does *not* check whether the source and
    /// target are compatible with each other.
    connect(ui, event) {
        if (this.reconnect === null) {
            // Create a new edge.

            // We attempt to guess what the intended label alignment is and what the intended edge
            // offset is, if the cells being connected form some path with existing connections.
            // Otherwise we revert to the currently-selected label alignment in the panel and the
            // default offset (0).
            const options = {
                label_alignment:
                    ui.panel.element.querySelector('input[name="label-alignment"]:checked').value,
                // The default settings for the other options are fine.
            };
            // If *every* existing connection to source and target has a consistent label alignment,
            // then `align` will be a singleton, in which case we use that element as the alignment.
            // If it has `left` and `right` in equal measure (regardless of `centre`), then
            // we will pick `centre`. Otherwise we keep the default. And similarly for `offset`.
            const align = new Map();
            const offset = new Map();
            // We only want to pick `centre` when the source and target are equally constraining
            // (otherwise we end up picking `centre` far too often). So we check that they're both
            // being considered equally. This means `centre` is chosen only rarely, but often in
            // the situations you want it. (This has no analogue in `offset`.)
            let balance = 0;

            const swap = (options) => {
                return {
                    label_alignment: {
                        left: "right",
                        centre: "centre",
                        over: "over",
                        right: "left",
                    }[options.label_alignment],
                    offset: -options.offset,
                };
            };

            const conserve = (options, between) => {
                return {
                    label_alignment: options.label_alignment,
                    // We ignore the offsets of edges that aren't directly `between` the
                    // source and target.
                    offset: between ? options.offset : null,
                };
            };

            const consider = (options, tip) => {
                if (!align.has(options.label_alignment)) {
                    align.set(options.label_alignment, 0);
                }
                align.set(options.label_alignment, align.get(options.label_alignment) + 1);
                if (options.offset !== null) {
                    if (!offset.has(options.offset)) {
                        offset.set(options.offset, 0);
                    }
                    offset.set(options.offset, offset.get(options.offset) + 1);
                }
                balance += tip;
            };

            const source_dependencies = ui.quiver.dependencies_of(this.source);
            const target_dependencies = ui.quiver.dependencies_of(this.target);
            for (const [edge, relationship] of source_dependencies) {
                consider({
                    source: swap,
                    target: options => conserve(options, target_dependencies.has(edge)),
                }[relationship](edge.options), -1);
            }
            for (const [edge, relationship] of target_dependencies) {
                consider({
                    source: options => conserve(options, source_dependencies.has(edge)),
                    target: swap,
                }[relationship](edge.options), 1);
            }

            if (align.size === 1) {
                options.label_alignment = align.keys().next().value;
            } else if (align.size > 0 && align.get("left") === align.get("right") && balance === 0) {
                options.label_alignment = "centre";
            }

            if (offset.size === 1) {
                options.offset = offset.keys().next().value;
            }

            if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                ui.deselect();
            }
            const label = "";
            // The edge itself does all the set up, such as adding itself to the page.
            const edge = new Edge(ui, label, this.source, this.target, options);
            ui.select(edge);
            if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                ui.panel.element.querySelector('label input[type="text"]').focus();
            }

            return edge;
        } else {
            // Reconnect an existing edge.
            const { edge, end } = this.reconnect;
            // We might be reconnecting an edge by its source, in which case, we need to switch
            // the traditional order of `source` and `target`, because the "source" will actually
            // be the target and vice versa.
            // Generally, the fixed end is always `this.source`, even if it isn't actually the
            // edge's source. This makes the interaction behaviour simpler elsewhere, because
            // one can always assume that `state.target` is the possibly-null, moving endpoint
            // that is the one of interest.
            const [source, target] = {
                source: [this.target, this.source],
                target: [this.source, this.target],
            }[end];
            edge.reconnect(ui, source, target);
            return edge;
        }
    }
};

/// Cells are being moved to a different position.
UIState.Move = class extends UIState {
    constructor(ui, origin, selection) {
        super();

        this.name = "move";

        /// The location from which the move was initiated.
        this.origin = origin;

        /// The location relative to which positions were last updated.
        this.previous = this.origin;

        /// The group of cells that should be moved.
        this.selection = selection;

        // Cells that are being moved are not considered part of the grid of cells
        // and therefore do not interact with one another.
        for (const cell of selection) {
            ui.positions.delete(`${cell.position}`);
        }
    }

    release(ui) {
        // Make sure we're not trying to release any cells on top of existing ones.
        for (const cell of this.selection) {
            if (ui.positions.has(`${cell.position}`)) {
                throw new Error(
                    "new cell position already contains a cell:",
                    ui.positions.get(`${cell.position}`),
                );
                return;
            }
        }
        // Now we know the positions are free, we can set them with impunity.
        for (const cell of this.selection) {
            ui.positions.set(`${cell.position}`, cell);
        }
    }
};

/// The UI view is being panned.
UIState.Pan = class extends UIState {
    constructor(key) {
        super();

        this.name = "pan";

        /// The location from which the pan was initiated (used to update the view relative to the
        /// origin).
        this.origin = null;

        /// The key with which the pan was initiated. Multiple keys (Option and Control) can be used
        /// for panning, so we need to make sure that we're consistent about the key we listen for
        /// when panning.
        this.key = key;
    }
};

/// The object responsible for controlling all aspects of the user interface.
class UI {
    constructor(element) {
        /// The quiver identified with the UI.
        this.quiver = new Quiver();

        /// The UI state (e.g. whether cells are being rearranged, or connected, etc.).
        this.state = null;

        /// The width and height of each grid cell. Defaults to `default_cell_size`.
        this.cell_width = new Map();
        this.cell_height = new Map();
        /// The default (minimum) size of each column and row, if a width or height has not been
        /// specified.
        this.default_cell_size = 128;
        /// The constraints on the width and height of each cell: we use the maximum constaint for
        /// final width/height. We store these separately from `cell_width` and `cell_height` to
        /// avoid recomputing the sizes every time, as we access them frequently.
        this.cell_width_constraints = new Map();
        this.cell_height_constraints = new Map();

        /// All currently selected cells;
        this.selection = new Set();

        /// The element in which to place the interface elements.
        this.element = element;

        /// A map from `x,y` positions to vertices. Note that this
        /// implies that only one vertex may occupy each position.
        this.positions = new Map();

        /// A set of unique idenitifiers for various objects (used for generating HTML `id`s).
        this.ids = new Map();

        /// The element containing all the cells themselves.
        this.canvas = null;
        /// The grid background.
        this.grid = null;

        /// The offset of the view (i.e. the centre of the view).
        this.view = Offset.zero();

        /// The size of the view (i.e. the document body dimensions).
        this.dimensions = new Dimensions(document.body.offsetWidth, document.body.offsetHeight);

        /// Undo/redo for actions.
        this.history = new History();

        /// The panel for viewing and editing cell data.
        this.panel = new Panel();

        /// The toolbar.
        this.toolbar = new Toolbar();

        /// What library to use for rendering labels.
        /// `null` is a basic HTML fallback: it is used until the relevant library is loaded.
        /// Options include MathJax and KaTeX.
        this.render_method = null;

        /// LaTeX macro definitions.
        this.macros = new Map();

        /// The URL from which the macros have been fetched (if at all).
        this.macro_url = null;
    }

    initialise() {
        this.element.classList.add("ui");
        this.switch_mode(UIState.default);

        // Set up the element containing all the cells.
        this.canvas = new DOM.Element("div", { class: "canvas" });
        this.element.appendChild(this.canvas.element);

        // Set up the panel for viewing and editing cell data.
        this.panel.initialise(this);
        this.element.appendChild(this.panel.element);

        // Set up the toolbar.
        this.toolbar.initialise(this);
        this.element.appendChild(this.toolbar.element);

        // Add the logo.
        this.element.appendChild(
            new DOM.Element("a", { href: "https://github.com/varkor/quiver", target: "_blank" })
                .add(new DOM.Element("img", { src: "quiver.svg", class: "logo" }))
                .element
        );

        // Add the insertion point for new nodes.
        const insertion_point = new DOM.Element("div", { class: "insertion-point" }).element;
        this.canvas.element.appendChild(insertion_point);

        // Handle panning via scrolling.
        window.addEventListener("wheel", (event) => {
            // We don't want to scroll while using the mouse wheel.
            event.preventDefault();

            // Hide the insertion point if it is visible.
            this.element.querySelector(".insertion-point").classList.remove("revealed");

            this.pan_view(new Offset(event.deltaX, event.deltaY));
        }, { passive: false });

        // The canvas is only as big as the window, so we need to resize it when the window resizes.
        window.addEventListener("resize", () => {
            // Adjust the view so that we keep everything centred.
            this.pan_view(new Offset(
                (this.dimensions.width - document.body.offsetWidth) / 2,
                (this.dimensions.height - document.body.offsetHeight) / 2,
            ));
            this.dimensions = new Dimensions(document.body.offsetWidth, document.body.offsetHeight);
        });

        // Add a move to the history.
        const commit_move_event = () => {
            if (!this.state.previous.sub(this.state.origin).is_zero()) {
                // We only want to commit the move event if it actually did moved things.
                this.history.add(this, [{
                    kind: "move",
                    displacements: Array.from(this.state.selection).map((vertex) => ({
                        vertex,
                        from: vertex.position.sub(this.state.previous.sub(this.state.origin)),
                        to: vertex.position,
                    })),
                }]);
            }
        };

        document.addEventListener("mousemove", (event) => {
            if (this.in_mode(UIState.Pan)) {
                // If we're panning, but no longer holding the requisite key, stop.
                // This can happen if we release the key when the document is not focused.
                if (!{ Control: event.ctrlKey, Alt: event.altKey }[this.state.key]) {
                    this.switch_mode(UIState.default);
                }
            }
        });

        document.addEventListener("mouseup", (event) => {
            if (event.button === 0) {
                if (this.in_mode(UIState.Pan)) {
                    // We only want to pan when the pointer is held.
                    this.state.origin = null;
                } else if (this.in_mode(UIState.Move)) {
                    commit_move_event();
                    this.switch_mode(UIState.default);
                } else if (this.in_mode(UIState.Connect)) {
                    // Stop trying to connect cells when the mouse is released outside
                    // the `<body>`.
                    if (this.state.forged_vertex) {
                        const created = new Set([this.state.source]);
                        this.history.add(this, [{
                            kind: "create",
                            cells: created,
                        }], false, this.selection_excluding(created));
                    }
                    this.switch_mode(UIState.default);
                }
            }
        });

        // Stop dragging cells when the mouse leaves the window.
        this.element.addEventListener("mouseleave", () => {
            if (this.in_mode(UIState.Move)) {
                commit_move_event();
                this.switch_mode(UIState.default);
            }
        });

        this.element.addEventListener("mousedown", (event) => {
            if (event.button === 0) {
                if (this.in_mode(UIState.Pan)) {
                    // Hide the insertion point if it is visible.
                    this.element.querySelector(".insertion-point").classList.remove("revealed");
                    // Record the position the pointer was pressed at, so we can pan relative
                    // to that location by dragging.
                    this.state.origin = this.offset_from_event(event).sub(this.view);
                } else if (!this.in_mode(UIState.Modal)) {
                    if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                        // Deselect cells when the mouse is pressed (at least when the Shift/Command
                        // /Control keys are not held).
                        this.deselect();
                    } else {
                        // Otherwise, simply deselect the label input (it's unlikely the user
                        // wants to modify all the cell labels at once).
                        this.panel.element.querySelector('label input[type="text"]').blur();
                    }
                }
            }
        });

        // A helper function for creating a new vertex, as there are
        // several actions that can trigger the creation of a vertex.
        const create_vertex = (position) => {
            const label = "\\bullet";
            return new Vertex(this, label, position);
        };

        // Move the insertion point under the pointer.
        const reposition_insertion_point = (event) => {
            const position = this.position_from_event(event);
            const offset = this.offset_from_position(position);
            offset.reposition(insertion_point);
            // Resize the insertion point appropriately for the grid cell.
            insertion_point.style.width
                = `${this.cell_size(this.cell_width, position.x) - CONSTANTS.GRID_BORDER_WIDTH}px`;
            insertion_point.style.height
                = insertion_point.style.lineHeight
                = `${this.cell_size(this.cell_height, position.y) - CONSTANTS.GRID_BORDER_WIDTH}px`;
            return position;
        };

        // Clicking on the insertion point reveals it,
        // after which another click adds a new node.
        insertion_point.addEventListener("mousedown", (event) => {
            if (event.button === 0) {
                if (this.in_mode(UIState.Default)) {
                    event.preventDefault();
                    if (!insertion_point.classList.contains("revealed")) {
                        // Reveal the insertion point upon a click.
                        reposition_insertion_point(event);
                        insertion_point.classList.add("revealed", "pending");
                    } else {
                        // We only stop propagation in this branch, so that clicking once in an
                        // empty grid cell will deselect any selected cells, but clicking a second
                        // time to add a new vertex will not deselect the new, selected vertex we've
                        // just added. Note that it's not possible to select other cells in between
                        // the first and second click, because leaving the grid cell with the cursor
                        // (to select other cells) hides the insertion point again.
                        event.stopPropagation();
                        insertion_point.classList.remove("revealed");
                        // We want the new vertex to be the only selected cell, unless we've held
                        // Shift/Command/Control when creating it.
                        if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                            this.deselect();
                        }
                        const vertex = create_vertex(this.position_from_event(event));
                        this.history.add(this, [{
                            kind: "create",
                            cells: new Set([vertex]),
                        }]);
                        this.select(vertex);
                        // When the user is creating a vertex and adding it to the selection,
                        // it is unlikely they expect to edit all the labels simultaneously,
                        // so in this case we do not focus the input.
                        if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                            this.panel.element.querySelector('label input[type="text"]').select();
                        }
                    }
                }
            }
        });

        // If we move the mouse (without releasing it) while the insertion
        // point is revealed, it will transition from a `"pending"` state
        // to an `"active"` state. Moving the mouse off the insertion
        // point in this state will create a new vertex and trigger the
        // connection mode.
        insertion_point.addEventListener("mousemove", () => {
            if (insertion_point.classList.contains("pending")) {
                insertion_point.classList.remove("pending");
                insertion_point.classList.add("active");
            }
        });

        // If we release the mouse while hovering over the insertion point,
        // there are two possibilities. Either we haven't moved the mouse,
        // in which case the insertion point loses its `"pending"` or
        // `"active"` state, or we have, in which case we're mid-connection
        // and we need to create a new vertex and connect it.
        insertion_point.addEventListener("mouseup", (event) => {
            if (event.button === 0) {
                insertion_point.classList.remove("pending", "active");

                // When releasing the mouse over an empty grid cell, we want to create a new
                // cell and connect it to the source.
                if (this.in_mode(UIState.Connect)) {
                    event.stopImmediatePropagation();
                    // We only want to forge vertices, not edges (and thus 1-cells).
                    if (this.state.source.is_vertex()) {
                        this.state.target
                            = create_vertex(this.position_from_event(event));
                        // Usually this vertex will be immediately deselected, except when Shift
                        // is held, in which case we want to select the forged vertices *and* the
                        // new edge.
                        this.select(this.state.target);
                        const created = new Set([this.state.target]);
                        const actions = [{
                            kind: "create",
                            cells: created,
                        }];

                        if (this.state.forged_vertex) {
                            created.add(this.state.source);
                        }

                        if (this.state.reconnect === null) {
                            // If we're not reconnecting an existing edge, then we need
                            // to create a new one.
                            const edge = this.state.connect(this, event);
                            created.add(edge);
                        } else {
                            // Unless we're holding Shift/Command/Control (in which case we just add
                            // the new vertex to the selection) we want to focus and select the new
                            // vertex.
                            const { edge, end } = this.state.reconnect;
                            if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                                this.deselect();
                                this.select(this.state.target);
                                this.panel.element.querySelector('label input[type="text"]')
                                    .select();
                            }
                            actions.push({
                                kind: "connect",
                                edge,
                                end,
                                from: edge[end],
                                to: this.state.target,
                            });
                            this.state.connect(this, event);
                        }

                        this.history.add(this, actions, false, this.selection_excluding(created));
                    }
                    this.switch_mode(UIState.default);
                }
            }
        });

        // If the cursor leaves the insertion point and the mouse has *not*
        // been held, it gets hidden again. However, if the cursor leaves the
        // insertion point whilst remaining held, then the insertion point will
        // be `"active"` and we create a new vertex and immediately start
        // connecting it to something (possibly an empty grid cell, which will
        // create a new vertex and connect them both).
        insertion_point.addEventListener("mouseleave", () => {
            insertion_point.classList.remove("pending");

            if (insertion_point.classList.contains("active")) {
                // If the insertion point is `"active"`, we're going to create
                // a vertex and start connecting it.
                insertion_point.classList.remove("active");
                const vertex = create_vertex(this.position_from_offset(new Offset(
                    insertion_point.offsetLeft,
                    insertion_point.offsetTop,
                )));
                this.select(vertex);
                this.switch_mode(new UIState.Connect(this, vertex, true));
                vertex.element.classList.add("source");
            } else if (!this.in_mode(UIState.Connect)) {
                // If the cursor leaves the insertion point and we're *not*
                // connecting anything, then hide it.
                insertion_point.classList.remove("revealed");
            }
        });

        // Moving the insertion point, panning, and rearranging cells.
        this.element.addEventListener("mousemove", (event) => {
            const position = reposition_insertion_point(event);

            if (this.in_mode(UIState.Pan) && this.state.origin !== null) {
                const new_offset = this.offset_from_event(event).sub(this.view);
                this.pan_view(this.state.origin.sub(new_offset));
                this.state.origin = new_offset;
            }

            // We want to reveal the insertion point if and only if it is
            // not at the same position as an existing vertex (i.e. over an
            // empty grid cell).
            if (this.in_mode(UIState.Connect)) {
                // We only permit the forgery of vertices, not edges.
                if (this.state.source.is_vertex() && this.state.target === null) {
                    insertion_point.classList
                        .toggle("revealed", !this.positions.has(`${position}`));
                }
            }

            // Moving cells around with the mouse.
            if (this.in_mode(UIState.Move)) {
                // Prevent dragging from selecting random elements.
                event.preventDefault();

                const new_position = (cell) => {
                    return cell.position.add(position).sub(this.state.previous);
                };

                // We will only try to reposition if the new position is actually different
                // (rather than the cursor simply having moved within the same grid cell).
                // On top of this, we prevent vertices from being moved into grid cells that
                // are already occupied by vertices.
                const occupied = Array.from(this.state.selection).some((cell) => {
                    return cell.is_vertex() && this.positions.has(`${new_position(cell)}`);
                });

                if (!position.eq(this.state.previous) && !occupied) {
                    // We'll need to move all of the edges connected to the moved vertices,
                    // so we keep track of the root vertices in `moved.`
                    const moved = new Set();
                    // Move all the selected vertices.
                    for (const cell of this.state.selection) {
                        if (cell.is_vertex()) {
                            cell.set_position(this, new_position(cell));
                            moved.add(cell);
                        }
                    }

                    // Update the column and row sizes in response to the new positions of the
                    // vertices.
                    if (!this.update_col_row_size(...Array.from(moved)
                        // Undo the transformation performed by `new_position`.
                        .map((vertex) => vertex.position.sub(position).add(this.state.previous))
                    )) {
                        // If we haven't rerendered the entire canvas due to a resize, then
                        // rerender the dependencies to make sure we move all of the edges connected
                        // to cells that have moved.
                        for (const cell of this.quiver.transitive_dependencies(moved)) {
                            cell.render(this);
                        }
                    }

                    this.state.previous = position;

                    // Update the panel, so that the interface is kept in sync (e.g. the
                    // rotation of the label alignment buttons).
                    this.panel.update(this);
                }
            }

            if (this.in_mode(UIState.Connect)) {
                // Prevent dragging from selecting random elements.
                event.preventDefault();

                // Update the position of the cursor.
                const offset = this.offset_from_event(event);
                this.state.update(this, offset);
            }
        });

        // Set the grid background.
        this.initialise_grid(this.canvas);
    }

    /// Active MathJax or KaTeX when it becomes available,
    /// updating all existing labels to make use of the library.
    activate_render_method(method) {
        this.render_method = method;

        // Rerender all the existing labels now that MathJax is available.
        for (const cell of this.quiver.all_cells()) {
            cell.render_label(this);
        }
    }

    /// Returns whether the UI has a particular state.
    in_mode(state) {
        return this.state instanceof state;
    }

    /// Transitions to a `UIState`.
    switch_mode(state) {
        if (this.state === null || this.state.constructor !== state.constructor) {
            if (this.state !== null) {
                // Clean up any state for which this state is responsible.
                this.state.release(this);
                if (this.state.name !== null) {
                    this.element.classList.remove(this.state.name);
                }
            }
            this.state = state;
            if (this.state.name !== null) {
                this.element.classList.add(this.state.name);
            }
        }
    }

    /// Get the width or height of a particular grid cell. You should use this instead of directly
    /// accessing `cell_width` or `cell_height` to ensure it defaults to `default_cell_size`.
    cell_size(sizes, index) {
        return sizes.get(index) || this.default_cell_size;
    }

    /// Get a column or row number corresponding to an offset (in pixels), as well as the partial
    /// offset from the absolute position of that column and row origin.
    cell_from_offset(sizes, offset) {
        // We explore the grid in both directions, starting from the origin.
        let index = 0;
        const original_offset = offset;
        if (offset === 0) {
            return [index, 0];
        }
        // The following two loops have been kept separate to increase readability.
        // Explore to the right or bottom...
        while (offset >= 0) {
            const size = this.cell_size(sizes, index);
            if (offset < size) {
                return [index, original_offset - offset];
            }
            offset -= size;
            ++index;
        }
        // Explore to the left or top...
        while (offset <= 0) {
            --index;
            const size = this.cell_size(sizes, index);
            if (Math.abs(offset) < size) {
                return [index, original_offset - (offset + size)];
            }
            offset += size;
        }
    }

    /// Get a column and row number corresponding to an offset, as well as the partial offsets from
    /// the absolute positions of the column and row. See `cell_from_offset` for details.
    col_row_offset_from_offset(offset) {
        return [
            this.cell_from_offset(this.cell_width, offset.left),
            this.cell_from_offset(this.cell_height, offset.top),
        ];
    }

    /// Get a column and row number corresponding to an offset.
    col_row_from_offset(offset) {
        return this.col_row_offset_from_offset(offset).map(([index, _]) => index);
    }

    /// Convert an `Offset` (pixels) to a `Position` (cell indices).
    /// The inverse function is `offset_from_position`.
    position_from_offset(offset) {
        const [col, row] = this.col_row_from_offset(offset);
        return new Position(col, row);
    }

    /// Returns the centre of the canvas.
    body_offset() {
        return new Offset(document.body.offsetWidth / 2, document.body.offsetHeight / 2);
    }

    /// A helper method for getting a position from an event.
    position_from_event(event) {
        return this.position_from_offset(this.offset_from_event(event));
    }

    /// A helper method for getting an offset from an event.
    offset_from_event(event) {
        return new Offset(event.pageX, event.pageY).add(this.view);
    }

    /// Returns half the size of the cell at the given `position`.
    cell_centre_at_position(position) {
        return new Offset(
            this.cell_size(this.cell_width, position.x) / 2,
            this.cell_size(this.cell_height, position.y) / 2,
        );
    }

    /// Computes the offset to the centre of the cell at `position`.
    centre_offset_from_position(position) {
        const offset = this.offset_from_position(position);
        const centre = this.cell_centre_at_position(position);
        return offset.add(centre);
    }

    /// Convert a `Position` (cell indices) to an `Offset` (pixels).
    /// The inverse function is `position_from_offset`.
    offset_from_position(position) {
        const offset = Offset.zero();

        // We attempt to explore in each of the four directions in turn.
        // These four loops could be simplified, but have been left as-is to aid readability.

        if (position.x > 0) {
            for (let col = 0; col < Math.floor(position.x); ++col) {
                offset.left += this.cell_size(this.cell_width, col);
            }
            offset.left
                += this.cell_size(this.cell_width, Math.floor(position.x)) * (position.x % 1);
        }
        if (position.x < 0) {
            for (let col = -1; col >= position.x; --col) {
                offset.left -= this.cell_size(this.cell_width, col);
            }
            offset.left
                += this.cell_size(this.cell_width, Math.floor(position.x)) * (position.x % 1);
        }

        if (position.y > 0) {
            for (let row = 0; row < Math.floor(position.y); ++row) {
                offset.top += this.cell_size(this.cell_height, row);
            }
            offset.top
                += this.cell_size(this.cell_height, Math.floor(position.y)) * (position.y % 1);
        }
        if (position.y < 0) {
            for (let row = -1; row >= position.y; --row) {
                offset.top -= this.cell_size(this.cell_height, row);
            }
            offset.top
                += this.cell_size(this.cell_height, Math.floor(position.y)) * (position.y % 1);
        }

        return offset;
    }

    /// Update the width of the grid columns and the heights of the grid rows at each of the given
    /// positions.
    /// The maximum width/height of each cell in a column/row will be used to determine the width/
    /// height of each column/row.
    ///
    /// Returns whether the entire quiver was rerendered (in which case the caller may be able to
    /// avoid rerendering).
    update_col_row_size(...positions) {
        // If no sizes change, we do not have to redraw the grid and cells. Otherwise, we must
        // redraw everything, as a resized column or row essentially reflows the entire graph.
        let rerender = false;
        // We keep the view centred as best we can, so we have to adjust the view if anything is
        // resized.
        let view_offset = Offset.zero();

        for (const position of positions) {
            // Compute how much each column or row size has changed and update the size in
            // `cell_width_constraints` or `cell_height_constraints`.
            const delta = (constraints, sizes, offset, margin) => {
                // The size of a column or row is determined by the largest cell.
                const max_size
                    = Math.max(0, ...Array.from(constraints.get(offset)).map(([_, size]) => size));
                const new_size = Math.max(this.default_cell_size, max_size + margin);
                const delta = new_size - this.cell_size(sizes, offset);

                if (delta !== 0) {
                    sizes.set(offset, new_size);
                }

                return delta;
            }

            // We keep a margin around the content of each cell. This gives space for dragging them
            // with the mouse.
            const MARGIN_X = this.default_cell_size * 0.5;
            const MARGIN_Y = this.default_cell_size * 0.5;

            const delta_x = delta(
                this.cell_width_constraints,
                this.cell_width,
                position.x,
                MARGIN_X,
            );
            const delta_y = delta(
                this.cell_height_constraints,
                this.cell_height,
                position.y,
                MARGIN_Y,
            );

            if (delta_x !== 0 || delta_y !== 0) {
                // Compute how much to adjust the view in order to keep it centred appropriately.
                const offset = new Offset(
                    delta_x / 2 * (position.x >= 0 ? -1 : 1),
                    delta_y / 2 * (position.y >= 0 ? -1 : 1),
                );
                view_offset = view_offset.sub(offset);
                rerender = true;
            }
        }

        if (rerender) {
            // If any of the column or row sizes changed, we need to rerender everything.
            // First, we reposition the grid and redraw it.
            this.pan_view(view_offset);
            // Then, we rerender all of the cells, which will have changed position.
            this.quiver.rerender(this);
        }

        return rerender;
    }

    /// Updates the size of the content of a cell. If the size is larger than the maximum of all
    /// other cells in that column or row, we resize the column or row to fit the content in.
    /// This means we do not have to resize the text inside a cell, for instance, to make things
    /// fit.
    update_cell_size(cell, width, height) {
        const update_size = (constraints, offset, size) => {
            if (!constraints.has(offset)) {
                constraints.set(offset, new Map());
            }
            constraints.get(offset).set(cell, size);
        };

        update_size(this.cell_width_constraints, cell.position.x, width);
        update_size(this.cell_height_constraints, cell.position.y, height);

        // Resize the grid if need be.
        this.update_col_row_size(cell.position);
    }

    /// Returns the current UI selection, excluding the given `cells`.
    selection_excluding(cells) {
        const selection = new Set(this.selection);
        for (const cell of cells) {
            selection.delete(cell);
        }
        return selection;
    }

    /// A helper method to trigger a UI event immediately, but later in the event queue.
    static delay(f, duration = 0) {
        setTimeout(f, duration);
    }

    /// Selects specific `cells`. Note that this does *not* deselect any cells that were
    /// already selected. For this, call `deselect()` beforehand.
    select(...cells) {
        let selection_changed = false;
        // The selection set is treated immutably, so we duplicate it here to
        // ensure that existing references to the selection are not modified.
        this.selection = new Set(this.selection);
        for (const cell of cells) {
            if (!this.selection.has(cell)) {
                this.selection.add(cell);
                cell.select();
                selection_changed = true;
            }
        }
        if (selection_changed) {
            this.panel.update(this);
            this.toolbar.update(this);
        }
    }

    /// Deselect a specific `cell`, or deselect all cells if `cell` is null.
    deselect(cell = null) {
        if (cell === null) {
            for (cell of this.selection) {
                cell.deselect();
            }
            this.selection = new Set();
        } else {
            // The selection set is treated immutably, so we duplicate it here to
            // ensure that existing references to the selection are not modified.
            this.selection = new Set(this.selection);
            if (this.selection.delete(cell)) {
                cell.deselect();
            }
        }

        this.panel.update(this);
        this.toolbar.update(this);
    }

    /// Adds a cell to the canvas.
    add_cell(cell) {
        if (cell.is_vertex()) {
            this.positions.set(`${cell.position}`, cell);
        }
        this.canvas.element.appendChild(cell.element);
    }

    /// Removes a cell.
    remove_cell(cell, when) {
        // Remove this cell and its dependents from the quiver and then from the HTML.
        for (const removed of this.quiver.remove(cell, when)) {
            if (removed.is_vertex()) {
                this.positions.delete(`${removed.position}`);
            }
            this.deselect(removed);
            removed.element.remove();
        }
    }

    /// Repositions the view by a relative offset.
    /// If `offset` is positive, then everything will appear to move towards the top left.
    pan_view(offset) {
        this.view.left += offset.left;
        this.view.top += offset.top;
        this.canvas.element.style.transform
            = `translate(${-this.view.left}px, ${-this.view.top}px)`;
        this.grid.element.style.transform = `translate(${this.view.left}px, ${this.view.top}px)`;
        this.update_grid();
    }

    /// Centre the view on the quiver.
    centre_view() {
        if (this.quiver.cells.length > 0 && this.quiver.cells[0].size > 0) {
            // We want to centre the view on the diagram, so we take the range of all vertex
            // offsets.
            let min_offset = new Offset(Infinity, Infinity);
            let max_offset = new Offset(-Infinity, -Infinity);
            this.pan_view(this.view.neg());

            for (const vertex of this.quiver.cells[0]) {
                const offset = this.centre_offset_from_position(vertex.position);
                const centre = this.cell_centre_at_position(vertex.position);
                min_offset = min_offset.min(offset.sub(centre));
                max_offset = max_offset.max(offset.add(centre));
            }

            const view_offset = new Offset(
                document.body.offsetWidth - this.panel.element.offsetWidth,
                document.body.offsetHeight,
            );
            this.pan_view(min_offset.add(max_offset).sub(view_offset).div(2));
        }
    }

    /// Returns a unique identifier for an object.
    unique_id(object) {
        if (!this.ids.has(object)) {
            this.ids.set(object, this.ids.size);
        }
        return this.ids.get(object);
    }

    /// Returns the active element if it is a text input field. (If it is, certain
    /// actions (primarily keyboard shortcuts) will be disabled.)
    input_is_active() {
        return document.activeElement.matches('label input[type="text"]') && document.activeElement;
    }

    /// Gets the label element for a cell and clears it, or creates a new one if it does not exist.
    static clear_label_for_cell(cell, buffer = false) {
        let label = cell.element.querySelector(`.label${!buffer ? ":not(.buffer)" : "buffer"}`);
        if (label !== null) {
            label = new DOM.Element(label);
            label.clear();
            return label;
        } else {
            label = new DOM.Element("div", { class: "label" });
            if (buffer) {
                label.class_list.add("buffer");
            }
            return label;
        }
    }

    /// Resizes a label to fit within a cell.
    resize_label(cell, label) {
        // How wide, relative to the cell, a label can be. This needs to be smaller than
        // 1.0 to leave room for arrows between cells, as cells are immediately adjacent.
        const MAX_LABEL_WIDTH = 0.8;
        // The text scaling decrement size. Must be strictly between 0 and 1.
        const LABEL_SCALE_STEP = 0.9;

        let max_width;
        if (cell.is_vertex()) {
            max_width = this.cell_size(this.cell_width, cell.position.x) * MAX_LABEL_WIDTH;
        } else {
            const offset_for = (endpoint) => {
                if (endpoint.is_vertex()) {
                    return this.centre_offset_from_position(endpoint.position);
                } else {
                    return endpoint.offset;
                }
            };
            // Calculate the distance between the endpoints.
            const length = offset_for(cell.target).sub(offset_for(cell.source)).length();
            max_width = length * MAX_LABEL_WIDTH;
        }

        // If vertices are too large (or too small), we resize the grid to fit them.
        if (cell.is_vertex()) {
            this.update_cell_size(
                cell,
                label.offsetWidth,
                label.offsetHeight,
            );
        }

        // Reset the label font size for edges, to reduce overlap.
        if (cell.is_edge()) {
            label.style.fontSize = "";
            // Ensure that the label fits within the cell by dynamically resizing it.
            while (label.offsetWidth > max_width) {
                const new_size = parseFloat(
                    window.getComputedStyle(label).fontSize,
                ) * LABEL_SCALE_STEP;
                label.style.fontSize = `${new_size}px`;
            }
        }

        if (cell.is_vertex()) {
            // 1-cells take account of the dimensions of the cell label to be drawn snugly,
            // so if the label is resized, the edges need to be redrawn.
            for (const edge of this.quiver.transitive_dependencies([cell], true)) {
                edge.render(this);
            }
        }

        return [label.offsetWidth, label.offsetHeight];
    }

    /// Returns the declared macros in a format amenable to passing to the LaTeX renderer.
    latex_macros() {
        switch (this.render_method) {
            case null:
                return this.macros;

            case "MathJax":
                // This seems to be more effective than defining macros using `MathJax.Hub.Config`.
                return Array.from(this.macros).map(([name, { definition, arity }]) => {
                    return `\\newcommand{${name}}[${arity}]{${definition}}`;
                }).join("");

            case "KaTeX":
                const macros = {};
                for (const [name, { definition }] of this.macros) {
                    // Arities are implicit in KaTeX.
                    macros[name] = definition;
                }
                return macros;
        }
    }

    /// Renders TeX with MathJax or KaTeX and returns the corresponding element.
    render_tex(cell, label, tex = "", callback = x => x) {
        const after = (x) => {
            const sizes = this.resize_label(cell, label.element);
            if (cell.is_vertex()) {
                // If the cell size has changed, we may need to resize the grid to fit.
                cell.resize_content(this, sizes);
            }

            callback(x);
        };

        switch (this.render_method) {
            case null:
                label.add(tex);
                // Simulate the usual queue delay.
                UI.delay(() => after());
                break;

            case "MathJax":
                label.add(`\\(${this.latex_macros()}${tex}\\)`);

                // We're going to fade the label in once it's rendered, so it looks less janky.
                label.element.style.display = "none";
                label.element.style.opacity = 0;

                MathJax.Hub.queue.Push(
                    ["Typeset", MathJax.Hub, label.element],
                    () => {
                        label.element.style.display = "block";
                        label.element.style.opacity = 1;
                    },
                    after,
                );

                break;

            case "KaTeX":
                try {
                    katex.render(
                        tex.replace(/\$/g, "\\$"),
                        label.element,
                        {
                            throwOnError: false,
                            errorColor: "hsl(0, 100%, 40%)",
                            macros: this.latex_macros(),
                        },
                    );
                } catch (_) {
                    // Currently all errors are disabled, so we don't expect to encounter this case.
                    label.class_list.add("error");
                    label.add(tex);
                }
                // Simulate the usual queue delay.
                UI.delay(() => after());
                break;
        }

        return label;
    }

    // A helper method for displaying error banners.
    // `type` can be used to selectively dismiss such errors (using the `type` argument on
    // `dismiss_error`).
    static display_error(message, type = null) {
        // If there's already an error, it's not unlikely that subsequent errors will be triggered.
        // Thus, we don't display an error banner if one is already displayed.
        if (document.body.querySelector(".error-banner:not(.hidden)") === null) {
            const error = new DOM.Element("div", { class: "error-banner hidden" })
                .add(message)
                .add(
                    new DOM.Element("button", { class: "close" })
                        .listen("click", () => UI.dismiss_error())
                ).element;
            if (type !== null) {
                error.setAttribute("data-type", type);
            }
            document.body.appendChild(error);
            // Animate the banner's entry.
            UI.delay(() => error.classList.remove("hidden"));
        }
    }

    /// A helper method for dismissing error banners.
    /// Returns whether there was any banner to dismiss.
    /// If `type` is non-null, `dismiss_error` will only dismiss errors whose type matches.
    static dismiss_error(type = null) {
        const error = document.body.querySelector(`.error-banner${
            type !== null ? `[data-type="${type}"]` : ""
        }`);
        if (error) {
            const SECOND = 1000;
            error.classList.add("hidden");
            setTimeout(() => error.remove(), 0.2 * SECOND);

            return true;
        } else {
            return false;
        }
    }

    /// Create the canvas upon which the grid will be drawn.
    initialise_grid(element) {
        const [width, height] = [document.body.offsetWidth, document.body.offsetHeight];
        this.grid = new DOM.Canvas(null, width, height, { class: "grid" });
        element.add(this.grid);
        this.update_grid();
    }

    /// Update the grid with respect to the view and size of the window.
    update_grid() {
        // Constants for parameters of the grid pattern.
        // The (average) length of the dashes making up the cell border lines.
        const DASH_LENGTH = this.default_cell_size / 16;
        // The border colour.
        const BORDER_COLOUR = "lightgrey";

        const [width, height] = [document.body.offsetWidth, document.body.offsetHeight];
        const canvas = this.grid;
        canvas.resize(width, height);

        const context = canvas.context;
        context.strokeStyle = BORDER_COLOUR;
        context.lineWidth = CONSTANTS.GRID_BORDER_WIDTH;
        context.setLineDash([DASH_LENGTH]);

        // We want to centre the horizontal and vertical dashes, so we get little crosses in the
        // corner of each grid cell. This is best effort: it is perfect when each column and row
        // is the default size, but otherwise may be imperfect.
        const dash_offset = -DASH_LENGTH / 2;

        const offset = this.view.add(this.body_offset());

        const [[left_col, left_offset], [top_row, top_offset]] = this.col_row_offset_from_offset(
            offset.sub(new Offset(width / 2, height / 2))
        );
        const [[right_col,], [bottom_row,]] = this.col_row_offset_from_offset(
            offset.add(new Offset(width / 2, height / 2))
        );

        // Draw the vertical lines.
        context.beginPath();
        for (let col = left_col, x = left_offset - offset.left + width / 2;
                col <= right_col; x += this.cell_size(this.cell_width, col++)) {
            context.moveTo(x, 0);
            context.lineTo(x, height);
        }
        context.lineDashOffset = offset.top - dash_offset - height % this.default_cell_size / 2;
        context.stroke();

        // Draw the horizontal lines.
        context.beginPath();
        for (let row = top_row, y = top_offset - offset.top + height / 2;
                row <= bottom_row; y += this.cell_size(this.cell_height, row++)) {
            context.moveTo(0, y);
            context.lineTo(width, y);
        }
        context.lineDashOffset = offset.left - dash_offset - width % this.default_cell_size / 2;
        context.stroke();
    }

    /// Load macros from a string, which will be used in all LaTeX labels.
    load_macros(definitions) {
        // Currently, only macros without arguments are supported.
        const newcommand = /^\\newcommand\{\\([a-zA-Z]+)\}(?:\[(\d)\])?\{(.*)\}$/;

        const macros = new Map();
        for (let line of definitions.split("\n")) {
            line = line.trim();
            if (line === "" || line.startsWith("%")) {
                // Skip empty lines and comments.
                continue;
            }
            const match = line.match(newcommand);
            if (match !== null) {
                const [, command, arity = 0, definition] = match;
                macros.set(`\\${command}`, {
                    definition,
                    arity,
                });
            } else {
                console.warn(`Ignoring unrecognised macro definition: \`${line}\``);
            }
        }
        this.macros = macros;

        // Rerender all the existing labels with the new macro definitions.
        for (const cell of this.quiver.all_cells()) {
            cell.render_label(this);
        }
    }

    /// Load macros from a URL.
    load_macros_from_url(url) {
        // Reset the stored macro URL. We don't want to store outdated URLs, but we also don't
        // want to store invalid URLs, so we'll set `macro_url` when we succeed in fetching the
        // definitions.
        this.macro_url = null;

        const macro_input = this.panel.element.querySelector(".bottom input");
        url = url.trim();
        macro_input.value = url;

        const success_indicator = macro_input.parentElement.querySelector(".success-indicator");
        success_indicator.classList.remove("success", "failure");
        success_indicator.classList.add("unknown");

        // Clear the error banner if it's an error caused by a previous failure of
        // `load_macros`.
        UI.dismiss_error("macro-load");

        fetch(url)
            .then((response) => response.text())
            .then((text) => {
                this.load_macros(text);
                this.macro_url = url;
                success_indicator.classList.remove("unknown");
                success_indicator.classList.add("success");
                macro_input.blur();
            })
            .catch(() => {
                UI.display_error(
                    "Macro definitions could not be loaded " +
                    "from the given URL.",
                    "macro-load",
                );
                success_indicator.classList.remove("unknown");
                success_indicator.classList.add("failure");
            })
    }
}

/// The history system (i.e. undo and redo).
class History {
    constructor() {
        /// A list of all actions taken by the user.
        /// Each "action" actually comprises a list of atomic actions.
        this.actions = [];

        /// The index after the last taken action (usually equal to `this.actions.length`).
        /// `0` therefore signifies that no action has been taken (or we've reverted history
        /// to that point).
        this.present = 0;

        /// We keep track of cell selection between events to conserve it as expected.
        this.selections = [new Set()];

        /// We allow history events to be collapsed if two consecutive events have the same
        /// (elementwise) `collapse` array. This tracks the previous one.
        this.collapse = null;
    }

    /// Add a reversible event to the history. Its effect will not be invoked (i.e. one should
    /// effect the action separately) unless `invoke` is `true`, as actions added to the history
    /// are often composites of individual actions that should not be performed atomically in
    /// real-time.
    add(ui, actions, invoke = false, selection = ui.selection) {
        // Append a new history event.
        // If there are future actions, clear them. (Our history only forms a list, not a tree.)
        ui.quiver.flush(this.present);
        this.selections.splice(this.present + 1, this.actions.length - this.present);
        // Update the current selection, so that if we undo to it, we restore the exact
        // selection we had before making the action.
        this.selections[this.present] = selection;
        this.actions.splice(this.present, this.actions.length - this.present);
        this.actions.push(actions);

        if (invoke) {
            this.redo(ui);
        } else {
            ++this.present;
        }

        this.selections.push(selection);
        this.collapse = null;

        // Update the history toolbar buttons (e.g. enabling Redo).
        ui.toolbar.update(ui);
    }

    /// Add a collapsible history event. This allows the last event to be modified later,
    /// replacing the history state.
    add_collapsible(ui, collapse, event, invoke = false) {
        this.add(ui, event, invoke);
        this.collapse = collapse;
    }

    /// Get the previous array of actions, if `collapse` matches `this.collapse`.
    get_collapsible_actions(collapse) {
        if (this.collapse !== null && collapse !== null
            && collapse.length === this.collapse.length
            && collapse.every((_, i) => collapse[i] === this.collapse[i]))
        {
            return this.actions[this.present - 1];
        } else {
            return null;
        }
    }

    /// Make the last action permanent, preventing it from being collapsed.
    permanentise() {
        this.collapse = null;
    }

    /// Pop the last event from the history. Assumes that `this.present === this.actions.length`.
    pop(ui) {
        --this.present;
        this.permanentise();
        ui.quiver.flush(this.present);
        this.selections.splice(this.present + 1, 1);
        this.actions.splice(this.present, 1);
    }

    /// Trigger an action. Returns whether the panel should be updated after the action.
    effect(ui, actions, reverse) {
        const order = Array.from(actions);

        // We need to iterate these in reverse order if `reverse` so that interacting actions
        // get executed in the correct order relative to one another.
        if (reverse) {
            order.reverse();
        }

        let update_panel = false;

        for (const action of order) {
            let kind = action.kind;
            if (reverse) {
                // Actions either have corresponding inverse actions or are self-inverse.
                kind = {
                    create: "delete",
                    delete: "create",
                    // Self-inverse actions will be automatically preserved.
                }[kind] || kind;
            }
            // Self-inverse actions often work by inverting `from`/`to`.
            const [from, to] = !reverse ? ["from", "to"] : ["to", "from"];
            // Actions will often require cells to be rendered transitively.
            const cells = new Set();
            switch (kind) {
                case "move":
                    // We perform these loops in sequence as cells may move
                    // directly into positions that have just been unoccupied.
                    for (const displacement of action.displacements) {
                        ui.positions.delete(`${displacement[from]}`);
                    }
                    for (const displacement of action.displacements) {
                        displacement.vertex.set_position(ui, displacement[to]);
                        ui.positions.set(
                            `${displacement.vertex.position}`,
                            displacement.vertex,
                        );
                        cells.add(displacement.vertex);
                    }
                    // We may need to resize the columns and rows that the cells moved from, if
                    // they were what was determining the column/row width/height.
                    if (ui.update_col_row_size(...action.displacements.map(
                        (displacement) => displacement[from])
                    )) {
                        // If `update_col_row_size` rerendered all the cells, there's no need to
                        // render them again later.
                        cells.clear();
                    }
                    break;
                case "create":
                    for (const cell of action.cells) {
                        ui.add_cell(cell);
                        ui.quiver.add(cell);
                    }
                    update_panel = true;
                    break;
                case "delete":
                    for (const cell of action.cells) {
                        ui.remove_cell(cell, this.present);
                    }
                    update_panel = true;
                    break;
                case "label":
                    for (const label of action.labels) {
                        label.cell.label = label[to];
                        ui.panel.render_tex(ui, label.cell);
                    }
                    update_panel = true;
                    break;
                case "label-alignment":
                    for (const alignment of action.alignments) {
                        alignment.edge.options.label_alignment = alignment[to];
                        alignment.edge.render(ui);
                    }
                    update_panel = true;
                    break;
                case "offset":
                    for (const offset of action.offsets) {
                        offset.edge.options.offset = offset[to];
                        cells.add(offset.edge);
                    }
                    update_panel = true;
                    break;
                case "reverse":
                    for (const cell of action.cells) {
                        if (cell.is_edge()) {
                            cell.reverse(ui);
                        }
                    }
                    update_panel = true;
                    break;
                case "style":
                    for (const style of action.styles) {
                        style.edge.options.style = style[to];
                        style.edge.render(ui);
                    }
                    update_panel = true;
                    break;
                case "connect":
                    const [source, target] = {
                        source: [action[to], action.edge.target],
                        target: [action.edge.source, action[to]],
                    }[action.end];
                    action.edge.reconnect(ui, source, target);
                    update_panel = true;
                    break;
            }
            for (const cell of ui.quiver.transitive_dependencies(cells)) {
                cell.render(ui);
            }
        }

        if (update_panel) {
            ui.panel.update(ui);
        }
        // Though we have already updated the `panel` if `update_panel`, `undo` and
        // `redo` may want to update the panel again, if they change which cells are
        // selected, so we pass this flag on.
        return update_panel;
    }

    undo(ui) {
        if (this.present > 0) {
            --this.present;
            this.permanentise();

            // Trigger the reverse of the previous action.
            const update_panel = this.effect(ui, this.actions[this.present], true);
            ui.deselect();
            ui.select(...this.selections[this.present]);
            if (update_panel) {
                ui.panel.update(ui);
            }

            ui.toolbar.update(ui);

            return true;
        }

        return false;
    }

    redo(ui) {
        if (this.present < this.actions.length) {
            // Trigger the next action.
            const update_panel = this.effect(ui, this.actions[this.present], false);

            ++this.present;
            this.permanentise();
            // If we're immediately invoking `redo`, then the selection has not
            // been recorded yet, in which case the current selection is correct.
            if (this.present < this.selections.length) {
                ui.deselect();
                ui.select(...this.selections[this.present]);
            }
            if (update_panel) {
                ui.panel.update(ui);
            }

            ui.toolbar.update(ui);

            return true;
        }

        return false;
    }
}

/// A panel for editing cell data.
class Panel {
    constructor() {
        /// The panel element.
        this.element = null;

        /// The displayed export format (`null` if not currently shown).
        this.export = null;
    }

    /// Set up the panel interface elements.
    initialise(ui) {
        this.element = new DOM.Element("div", { class: "panel" }).element;

        // Prevent propagation of mouse events when interacting with the panel.
        this.element.addEventListener("mousedown", (event) => {
            event.stopImmediatePropagation();
        });

        // Prevent propagation of scrolling when the cursor is over the panel.
        // This allows the user to scroll the panel when all the elements don't fit on it.
        this.element.addEventListener("wheel", (event) => {
            event.stopImmediatePropagation();
        }, { passive: true });

        // Local options, such as vertex and edge actions.
        const local = new DOM.Element("div", { class: "local" });
        this.element.appendChild(local.element);

        // The label.
        const label_input = new DOM.Element("input", { type: "text", disabled: true });
        const label = new DOM.Element("label").add("Label: ").add(label_input);
        local.add(label);

        // Handle label interaction: update the labels of the selected cells when
        // the input field is modified.
        label_input.listen("input", () => {
            const collapse = ["label", ui.selection];
            const actions = ui.history.get_collapsible_actions(collapse);
            if (actions !== null) {
                // If the previous history event was to modify the label, then
                // we're just going to modify that event rather than add a new
                // one. This means we won't have to undo every single character
                // change: we'll undo the entire label change.
                let unchanged = true;
                for (const action of actions) {
                    // This ought always to be true.
                    if (action.kind === "label") {
                        // Modify the `to` field of each label.
                        action.labels.forEach(label => {
                            label.to = label_input.element.value;
                            if (label.to !== label.from) {
                                unchanged = false;
                            }
                        });
                    }
                }
                // Invoke the new label changes immediately.
                ui.history.effect(ui, actions, false);
                if (unchanged) {
                    ui.history.pop(ui);
                }
            } else {
                // If this is the start of our label modification,
                // we need to add a new history event.
                ui.history.add_collapsible(ui, collapse, [{
                    kind: "label",
                    labels: Array.from(ui.selection).map((cell) => ({
                        cell,
                        from: cell.label,
                        to: label_input.element.value,
                    })),
                }], true);
            }
        }).listen("blur", () => {
            // As soon as the input is blurred, treat the label modification as
            // a discrete event, so if we modify again, we'll need to undo both
            // modifications to completely undo the label change.
            ui.history.permanentise();
        });

        // The label alignment options.

        // The radius of the box representing the text along the arrow.
        const RADIUS = 4;
        // The horizontal offset of the box representing the text from the arrowhead.
        const X_OFFSET = 2;
        // The vetical offset of the box representing the text from the arrow.
        const Y_OFFSET = 8;

        this.create_option_list(
            ui,
            local,
            [
                ["left", "Left align label", {}],
                ["centre", "Centre align label (clear)", {}],
                ["over", "Centre align label (over)", {}],
                ["right", "Right align label", {}]
            ],
            "label-alignment",
            [],
            false, // `disabled`
            (edges, value) => {
                ui.history.add(ui, [{
                    kind: "label-alignment",
                    alignments: Array.from(ui.selection)
                        .filter(cell => cell.is_edge())
                        .map((edge) => ({
                            edge,
                            from: edge.options.label_alignment,
                            to: value,
                        })),
                }]);
                edges.forEach(edge => edge.options.label_alignment = value);
            },
            (value) => {
                // The length of the arrow.
                const ARROW_LENGTH = 28;

                let y_offset;
                switch (value) {
                    case "left":
                        y_offset = -Y_OFFSET;
                        break;
                    case "centre":
                    case "over":
                        y_offset = 0;
                        break;
                    case "right":
                        y_offset = Y_OFFSET;
                        break;
                }

                const gap = value === "centre" ? { length: RADIUS * 4, offset: X_OFFSET } : null;

                return {
                    edge: {
                        length: ARROW_LENGTH,
                        options: Edge.default_options(),
                        gap,
                    },
                    shared: { y_offset },
                };
            },
            (svg, dimensions, shared) => {
                const rect = new DOM.SVGElement("rect", {
                    x: dimensions.width / 2 - X_OFFSET - RADIUS,
                    y: dimensions.height / 2 + shared.y_offset - RADIUS,
                    width: RADIUS * 2,
                    height: RADIUS * 2,
                }, {
                    stroke: "none",
                }).element;

                svg.appendChild(rect);

                return [{ element: rect, property: "fill" }];
            },
        );

        // The offset slider.
        local.add(
            new DOM.Element("label").add("Offset: ").add(
                new DOM.Element(
                    "input",
                    { type: "range", min: -3, value: 0, max: 3, step: 1, disabled: true }
                ).listen("input", (_, slider) => {
                    const value = parseInt(slider.value);
                    const collapse = ["offset", ui.selection];
                    const actions = ui.history.get_collapsible_actions(collapse);
                    if (actions !== null) {
                        // If the previous history event was to modify the offset, then
                        // we're just going to modify that event rather than add a new
                        // one, as with the label input.
                        let unchanged = true;
                        for (const action of actions) {
                            // This ought always to be true.
                            if (action.kind === "offset") {
                                // Modify the `to` field of each offset.
                                action.offsets.forEach((offset) => {
                                    offset.to = value;
                                    if (offset.to !== offset.from) {
                                        unchanged = false;
                                    }
                                });
                            }
                        }
                        // Invoke the new offset changes immediately.
                        ui.history.effect(ui, actions, false);
                        if (unchanged) {
                            ui.history.pop(ui);
                        }
                    } else {
                        // If this is the start of our offset modification,
                        // we need to add a new history event.
                        ui.history.add_collapsible(ui, collapse, [{
                            kind: "offset",
                            offsets: Array.from(ui.selection)
                                .filter(cell => cell.is_edge())
                                .map((edge) => ({
                                    edge,
                                    from: edge.options.offset,
                                    to: value,
                                })),
                        }], true);
                    }
                })
            )
        );

        // The button to reverse an edge.
        local.add(
            new DOM.Element("button", { title: "Reverse arrows", disabled: true })
                .add("⇌ Reverse")
                .listen("click", () => {
                    ui.history.add(ui, [{
                        kind: "reverse",
                        cells: ui.selection,
                    }], true);
                })
        );

        // The list of tail styles.
        // The length of the arrow to draw in the centre style buttons.
        const ARROW_LENGTH = 72;

        // To make selecting the arrow style button work as expected, we automatically
        // trigger the `"change"` event for the arrow style buttons. This in turn will
        // trigger `record_edge_style_change`, creating many unintentional history
        // actions. To avoid this, we prevent `record_edge_style_change` from taking
        // effect when it's already in progress using the `recording` flag.
        let recording = false;
        const record_edge_style_change = (modify) => {
            if (recording) {
                return;
            }
            recording = true;

            const clone = x => JSON.parse(JSON.stringify(x));
            const styles = new Map();
            for (const cell of ui.selection) {
                if (cell.is_edge()) {
                    styles.set(cell, clone(cell.options.style));
                }
            }

            modify();

            ui.history.add(ui, [{
                kind: "style",
                styles: Array.from(ui.selection)
                    .filter(cell => cell.is_edge())
                    .map((edge) => ({
                        edge,
                        from: styles.get(edge),
                        to: clone(edge.options.style),
                    })),
            }]);

            recording = false;
        };

        this.create_option_list(
            ui,
            local,
            [
                ["none", "No tail", { name: "none" }],
                ["maps to", "Maps to", { name: "maps to" }],
                ["mono", "Mono", { name: "mono"} ],
                ["top-hook", "Top hook", { name: "hook", side: "top" }, ["short"]],
                ["bottom-hook", "Bottom hook", { name: "hook", side: "bottom" }, ["short"]],
            ],
            "tail-type",
            ["vertical", "short", "arrow-style"],
            true, // `disabled`
            (edges, _, data) => record_edge_style_change(() => {
                edges.forEach(edge => edge.options.style.tail = data);
            }),
            (_, data) => {
                return {
                    edge: {
                        length: 0,
                        options: Edge.default_options(null, {
                            tail: data,
                            body: { name: "none" },
                            head: { name: "none" },
                        }),
                    },
                };
            },
        );

        // The list of body styles.
        this.create_option_list(
            ui,
            local,
            [
                ["1-cell", "1-cell", { name: "cell", level: 1 }],
                ["2-cell", "2-cell", { name: "cell", level: 2 }],
                ["dashed", "Dashed", { name: "dashed" }],
                ["dotted", "Dotted", { name: "dotted" }],
                ["squiggly", "Squiggly", { name: "squiggly" }],
                ["none", "No body", { name: "none" }],
            ],
            "body-type",
            ["vertical", "arrow-style"],
            true, // `disabled`
            (edges, _, data) => record_edge_style_change(() => {
                edges.forEach(edge => edge.options.style.body = data);
            }),
            (_, data) => {
                return {
                    edge: {
                        length: ARROW_LENGTH,
                        options: Edge.default_options(null, {
                            body: data,
                            head: { name: "none" },
                        }),
                    },
                };
            },
        );

        // The list of head styles.
        this.create_option_list(
            ui,
            local,
            [
                ["arrowhead", "Arrowhead", { name: "arrowhead" }],
                ["none", "No arrowhead", { name: "none" }],
                ["epi", "Epi", { name: "epi"} ],
                ["top-harpoon", "Top harpoon", { name: "harpoon", side: "top" }, ["short"]],
                ["bottom-harpoon", "Bottom harpoon", { name: "harpoon", side: "bottom" }, ["short"]],
            ],
            "head-type",
            ["vertical", "short", "arrow-style"],
            true, // `disabled`
            (edges, _, data) => record_edge_style_change(() => {
                edges.forEach(edge => edge.options.style.head = data);
            }),
            (_, data) => {
                return {
                    edge: {
                        length: 0,
                        options: Edge.default_options(null, {
                            head: data,
                            body: { name: "none" },
                        }),
                    },
                };
            },
        );

        // The list of (non-arrow) edge styles.
        this.create_option_list(
            ui,
            local,
            [
                ["arrow", "Arrow", Edge.default_options().style],
                ["adjunction", "Adjunction", { name: "adjunction" }],
                ["corner", "Pullback / pushout", { name: "corner" }],
            ],
            "edge-type",
            ["vertical", "centre"],
            true, // `disabled`
            (edges, _, data) => record_edge_style_change(() => {
                for (const edge of edges) {
                    // Update the edge style.
                    if (data.name !== "arrow" || edge.options.style.name !== "arrow") {
                        // The arrow is a special case, because it contains suboptions that we
                        // don't necessarily want to override. For example, if we have multiple
                        // edges selected, one of which is a non-default arrow and another which
                        // has a different style, clicking on the arrow option should not reset
                        // the style of the existing arrow.
                        edge.options.style = data;
                    }
                }

                // Enable/disable the arrow style buttons.
                ui.element.querySelectorAll('.arrow-style input[type="radio"]')
                    .forEach(element => element.disabled = data.name !== "arrow");

                // If we've selected the `"arrow"` style, then we need to
                // trigger the currently-checked buttons so that we get
                // the expected style, rather than the default style.
                if (data.name === "arrow") {
                    UI.delay(() => {
                        ui.element.querySelectorAll('.arrow-style input[type="radio"]:checked')
                            .forEach(element => element.dispatchEvent(new Event("change")));
                    });
                }
            }),
            (_, data) => {
                return {
                    edge: {
                        length: ARROW_LENGTH,
                        options: Edge.default_options(null, data),
                    },
                };
            },
        );

        const display_export_pane = (format, modify = (output) => output) => {
            // Handle export button interaction: export the quiver.
            // If the user clicks on two different exports in a row
            // we will simply switch the displayed export format.
            // Clicking on the same button twice closes the panel.
            if (this.export !== format) {
                ui.switch_mode(new UIState.Modal());

                // Get the encoding of the diagram.
                const output = ui.quiver.export(format);

                let export_pane;
                if (this.export === null) {
                    // Create the export pane.
                    export_pane = new DOM.Element("div", { class: "export" });
                    ui.element.appendChild(export_pane.element);
                } else {
                    // Find the existing export pane.
                    export_pane = new DOM.Element(ui.element.querySelector(".export"));
                }
                // The output may be modifier by the caller.
                export_pane.clear().add(modify(output));

                this.export = format;

                // Select the code for easy copying.
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(export_pane.element);
                selection.removeAllRanges();
                selection.addRange(range);
                // Disable cell data editing while the export pane is visible.
                this.update(ui);
            } else {
                this.dismiss_export_pane(ui);
            }
        };

        this.element.appendChild(
            new DOM.Element("div", { class: "bottom" }).add(
                new DOM.Element("div").add(
                    new DOM.Element("label").add("Macros: ")
                        .add(
                            new DOM.Element("input", {
                                type: "text",
                            }).listen("keydown", (event, input) => {
                                if (event.key === "Enter") {
                                    ui.load_macros_from_url(input.value);
                                    input.blur();
                                }
                            }).listen("paste", (_, input) => {
                                UI.delay(() => ui.load_macros_from_url(input.value));
                            })
                        ).add(
                            new DOM.Element("div", { class: "success-indicator" })
                        )
                )
            ).add(
                // The shareable link button.
                new DOM.Element("button", { class: "global" }).add("Get shareable link")
                    .listen("click", () => {
                        display_export_pane("base64", (output) => {
                            if (ui.macro_url !== null) {
                                return `${output}&macro_url=${encodeURIComponent(ui.macro_url)}`;
                            }
                            return output;
                        });
                    })
            ).add(
                // The export button.
                new DOM.Element("button", { class: "global" }).add("Export to LaTeX")
                    .listen("click", () => display_export_pane("tikz-cd"))
            ).element
        );
    }

    // A helper function for creating a list of radio inputs with backgrounds drawn based
    // on `draw_edge` with various arguments. This allows for easily customising edges
    // with visual feedback.
    create_option_list(
        ui,
        local,
        entries,
        name,
        classes,
        disabled,
        on_check,
        properties,
        augment_svg = () => [],
    ) {
        const options_list = new DOM.Element("div", { class: `options` });
        options_list.class_list.add(...classes);

        const create_option = (value, tooltip, data) => {
            const button = new DOM.Element("input", {
                type: "radio",
                name,
                value,
                title: tooltip,
            }).listen("change", (_, button) => {
                if (button.checked) {
                    const selected_edges = Array.from(ui.selection).filter(cell => cell.is_edge());
                    on_check(selected_edges, value, data);
                    for (const edge of selected_edges) {
                        edge.render(ui);
                    }
                }
            });
            button.element.disabled = disabled;
            options_list.add(button);

            // We're going to create background images for the label alignment buttons
            // representing each of the alignments. We do this by creating SVGs so that
            // the images are precisely right.
            // We create two background images per button: one for the `:checked` version
            // and one for the unchecked version.
            const backgrounds = [];

            const svg = new DOM.SVGElement("svg", { xmlns: "http://www.w3.org/2000/svg" }).element;

            const { shared, edge: { length, options, gap = null } } = properties(value, data);

            const { dimensions, alignment }
                = Edge.draw_edge(svg, options, length, Math.PI / 4, gap);
            // Align the background according the alignment of the arrow
            // (`"centre"` is default).
            if (alignment !== "centre") {
                // What percentage of the button to offset `"left"` or `"right"` aligned arrows.
                const BACKGROUND_PADDING = 20;

                button.element.style.backgroundPosition
                    = `${alignment} ${BACKGROUND_PADDING}% center`
            }

            // Trigger the callback to modify the SVG in some way after drawing the arrow.
            // `colour_properties` is an array of `{ object, property }` pairs. Each will
            // be set to the current `colour` in the loop below.
            const colour_properties = augment_svg(svg, dimensions, shared);

            for (const colour of ["black", "grey"]) {
                svg.style.stroke = colour;
                for (const { element, property } of colour_properties) {
                    element.style[property] = colour;
                }
                backgrounds.push(`url(data:image/svg+xml;utf8,${encodeURI(svg.outerHTML)})`);
            }
            button.element.style.backgroundImage = backgrounds.join(", ");

            return button;
        };

        for (const [value, tooltip, data, classes = []] of entries) {
            create_option(value, tooltip, data).class_list.add(...classes);
        }

        options_list.element.querySelector(`input[name="${name}"]`).checked = true;

        local.add(options_list);
    }

    /// We buffer the MathJax rendering to reduce flickering (KaTeX is fast enough not
    /// to require buffering).
    /// If the `.buffer` has no extra classes, then we are free to start a new MathJax
    /// TeX render.
    /// If the `.buffer` has a `.buffering` class, then we are rendering a label. This
    /// may be out of date, in which case we add a `.pending` class (which means we're
    /// going to rerender as soon as the current MathJax render has completed).
    render_tex(ui, cell) {
        const label = new DOM.Element(cell.element.querySelector(".label:not(.buffer)"));
        label.class_list.remove("error");

        const update_label_transformation = () => {
            if (cell.is_edge()) {
                cell.update_label_transformation(ui);
            } else {
                // `update_label_transformation` performs label resizing itself.
                cell.resize_content(ui, ui.resize_label(cell, label.element));
            }
        };

        switch (ui.render_method) {
            case null:
                label.clear().add(cell.label);
                update_label_transformation();
                break;

            case "MathJax":
                const buffer = cell.element.querySelector(".buffer");
                const jax = MathJax.Hub.getAllJax(buffer);
                if (!buffer.classList.contains("buffering") && jax.length > 0) {
                    buffer.classList.add("buffering");

                    MathJax.Hub.Queue(
                        ["Text", jax[0], `${ui.latex_macros()}${cell.label}`],
                        () => {
                            // Swap the label and the label buffer.
                            label.class_list.add("buffer");
                            buffer.classList.remove("buffer", "buffering");
                        },
                        update_label_transformation,
                    );
                } else if (!buffer.classList.contains("pending")) {
                    MathJax.Hub.Queue(() => this.render_tex(ui, cell));
                }
                break;

            case "KaTeX":
                try {
                    katex.render(
                        cell.label.replace(/\$/g, "\\$"),
                        label.element,
                        {
                            throwOnError: false,
                            errorColor: "hsl(0, 100%, 40%)",
                            macros: ui.latex_macros(),
                        },
                    );
                } catch (_) {
                    // Currently all errors are disabled, so we don't expect to encounter this case.
                    label.add(cell.label);
                    label.class_list.add("error");
                }
                update_label_transformation();
                break;
        }
    };

    /// Update the panel state (i.e. enable/disable fields as relevant).
    update(ui) {
        const input = this.element.querySelector('label input[type="text"]');
        const label_alignments = this.element.querySelectorAll('input[name="label-alignment"]');
        const slider = this.element.querySelector('input[type="range"]');

        // Modifying cells is not permitted when the export pane is visible.
        if (this.export === null) {
            // Default options (for when no cells are selected). We only need to provide defaults
            // for inputs that display their state even when disabled.
            if (ui.selection.size === 0) {
                input.value = "";
                slider.value = 0;
            }

            // Multiple selection is always permitted, so the following code must provide sensible
            // behaviour for both single and multiple selections (including empty selections).
            const selection_includes_edge = Array.from(ui.selection).some(cell => cell.is_edge());

            // Enable all the inputs iff we've selected at least one edge.
            this.element.querySelectorAll('input:not([type="text"]), button:not(.global)')
                .forEach(element => element.disabled = !selection_includes_edge);

            // Enable the label input if at least one cell has been selected.
            input.disabled = ui.selection.size === 0;
            if (input.disabled && document.activeElement === input) {
                // In Firefox, if the active element is disabled, then key
                // presses aren't registered, so we need to blur it manually.
                input.blur();
            }

            // Label alignment options are always enabled.
            for (const option of label_alignments) {
                option.disabled = false;
            }

            // A map from option names to values. If a value is `null`, that means that
            // there are multiple potential values, so we (in the case of radio buttons)
            // uncheck all such inputs or set them to an empty string (in the case of text
            // inputs).
            const values = new Map();
            let all_edges_are_arrows = selection_includes_edge;

            const consider = (name, value) => {
                if (values.has(name) && values.get(name) !== value) {
                    values.set(name, null);
                } else {
                    values.set(name, value);
                }
            };

            // Collect the consistent and varying input values.
            for (const cell of ui.selection) {
                // Options applying to all cells.
                consider("{label}", cell.label);

                // Edge-specific options.
                if (cell.is_edge()) {
                    consider("label-alignment", cell.options.label_alignment);
                    // The label alignment buttons are rotated to reflect the direction of the arrow
                    // when all arrows have the same direction (at least to the nearest multiple of
                    // 90°). Otherwise, rotation defaults to 0°.
                    consider("{angle}", cell.angle(ui));
                    consider("{offset}", cell.options.offset);
                    consider("edge-type", cell.options.style.name);

                    // Arrow-specific options.
                    if (cell.options.style.name === "arrow") {
                        for (const component of ["tail", "body", "head"]) {
                            let value;
                            // The following makes the assumption that the
                            // distinguished names are unique, even between
                            // different components.
                            switch (cell.options.style[component].name) {
                                case "cell":
                                    value = `${cell.options.style[component].level}-cell`;
                                    break;
                                case "hook":
                                case "harpoon":
                                    value = `${
                                        cell.options.style[component].side
                                    }-${cell.options.style[component].name}`;
                                    break;
                                default:
                                    value = cell.options.style[component].name;
                                    break;
                            }

                            consider(`${component}-type`, value);
                        }
                    } else {
                        all_edges_are_arrows = false;
                    }
                }
            }

            // Fill the consistent values for the inputs, checking and unchecking
            // radio buttons as relevant.
            for (const [name, value] of values) {
                switch (name) {
                    case "{label}":
                        input.value = value !== null ? value : "";
                        break;
                    case "{angle}":
                        const angle = value !== null ? value : 0;
                        for (const option of label_alignments) {
                            option.style.transform = `rotate(${
                                Math.round(2 * angle / Math.PI) * 90
                            }deg)`;
                        }
                        break;
                    case "{offset}":
                        slider.value = value !== null ? value : 0;
                        break;
                    default:
                        if (value === null) {
                            // Uncheck any checked input for which there are
                            // multiple selected values.
                            this.element.querySelectorAll(
                                `input[name="${name}"]:checked`
                            ).forEach(element => element.checked = false);
                        } else {
                            // Check any input for which there is a canonical choice of value.
                            this.element.querySelector(
                                `input[name="${name}"][value="${value}"]`
                            ).checked = true;
                        }
                        break;
                }
            }

            // Update the actual `value` attribute for the offset slider so that we can
            // reference it in the CSS.
            slider.setAttribute("value", slider.value);

            // Disable/enable the arrow style buttons.
            for (const option of this.element
                    .querySelectorAll('.arrow-style input[type="radio"]')) {
                option.disabled = !all_edges_are_arrows;
            }

            // Enable all inputs in the bottom section of the panel.
            this.element.querySelectorAll(`.bottom input[type="text"]`).forEach((input) => {
                input.disabled = false;
            });
        } else {
            // Disable all the inputs.
            this.element.querySelectorAll("input:not(.global), button:not(.global)")
                .forEach(element => element.disabled = true);
        }
    }

    /// Dismiss the export pane, if it is shown.
    dismiss_export_pane(ui) {
        if (this.export !== null) {
            ui.element.querySelector(".export").remove();
            this.export = null;
            ui.switch_mode(UIState.default);
            this.update(ui);
        }
    }
}

/// The toolbar, providing shortcuts to useful actions. This handles both the physical
/// toolbar buttons and the keyboard shortcuts.
class Toolbar {
    constructor() {
        /// The toolbar element.
        this.element = null;
    }

    initialise(ui) {
        this.element = new DOM.Element("div", { class: "toolbar" })
            .listen("mousedown", (event) => event.stopImmediatePropagation())
            .element;

        // By default, we display "Ctrl" and "Shift" as modifier keys, as most
        // operating systems use this to initiate keyboard shortcuts. For Mac
        // and iOS, we switch to displaying "⌘" and "⇧". However, both keys
        // (on any operating system) work with the shortcuts: this is simply
        // used to work out what to display.
        const apple_platform = /^(Mac|iPhone|iPod|iPad)/.test(navigator.platform);

        // A map from keys to the shortcuts to which they correspond.
        const shortcuts = new Map();

        // Defines the contexts in which a keyboard shortcut may trigger.
        const SHORTCUT_PRIORITY = new Enum(
            "SHORTCUT_PRIORITY",
            // Triggers whenever the keyboard shortcut is held.
            "Always",
            // Triggers when an input is not focused, or if the shortcut
            // has no effect on the input.
            "Defer",
            // Triggers when an input is not focused.
            "Conservative",
        );

        // Associate an action to a keyboard shortcut. Multiple shortcuts can be
        // associated to a single action, making it easier to facilitate different
        // keyboard layouts.
        const add_shortcut = (combinations, action, button = null, unaction = null) => {
            for (const shortcut of combinations) {
                if (!shortcuts.has(shortcut.key)) {
                    shortcuts.set(shortcut.key, []);
                }
                shortcuts.get(shortcut.key).push({
                    // `null` means we don't care about whether the modifier key
                    // is pressed or not, so we need to special case it.
                    modifier: shortcut.modifier !== null ? (shortcut.modifier || false) : null,
                    shift: shortcut.shift !== null ? (shortcut.shift || false) : null,
                    // The function to call when the shortcut is triggered.
                    action,
                    // The function to call (if any) when the shortcut is released.
                    unaction,
                    context: shortcut.context || SHORTCUT_PRIORITY.Conservative,
                    button,
                });
            }
        };

        const add_action = (symbol, name, combinations, action, disabled) => {
            const shortcuts_keys = [];
            for (const shortcut of combinations) {
                // Format the keyboard shortcut to make it discoverable in the toolbar.
                let key = shortcut.key;
                if (key.length === 1) {
                    // Upper case any letter key.
                    key = key.toUpperCase();
                }
                const shortcut_keys = [key];
                if (shortcut.modifier) {
                    shortcut_keys.unshift(apple_platform ? "⌘" : "Ctrl");
                }
                if (shortcut.shift) {
                    shortcut_keys.unshift(apple_platform ? "⇧" : "Shift");
                }
                shortcuts_keys.push(shortcut_keys.join(apple_platform ? "" : "+"));
            }
            // For now, we simply display the first shortcut (there's rarely enough room
            // to display more than one shortcut name).
            const shortcut_name = shortcuts_keys.slice(0, 1).join("/");

            const button = new DOM.Element("button", { class: "action", "data-name": name })
                .add(new DOM.Element("span", { class: "symbol" }).add(symbol))
                .add(new DOM.Element("span", { class: "name" }).add(name))
                .add(new DOM.Element("span", { class: "shortcut" }).add(shortcut_name))
                .listen("mousedown", (event) => event.stopImmediatePropagation())
                .listen("click", (event) => action(event));

            if (disabled) {
                button.element.disabled = true;
            }

            add_shortcut(combinations, action, button);

            this.element.appendChild(button.element);
            return button;
        };

        // Add all of the toolbar buttons.

        add_action(
            "⎌",
            "Undo",
            [{ key: "z", modifier: true, context: SHORTCUT_PRIORITY.Defer }],
            () => {
                ui.history.undo(ui);
            },
            true,
        );

        const redo = add_action(
            "⎌",
            "Redo",
            [{ key: "Z", modifier: true, shift: true, context: SHORTCUT_PRIORITY.Defer }],
            () => {
                ui.history.redo(ui);
            },
            true,
        );
        // There's no "Redo" symbol in Unicode, so we make do by flipping the "Undo"
        // symbol horizontally.
        redo.element.querySelector(".symbol").classList.add("flip");

        add_action(
            "■",
            "Select all",
            [{ key: "a", modifier: true, context: SHORTCUT_PRIORITY.Defer }],
            () => {
                ui.select(...ui.quiver.all_cells());
            },
            true,
        );

        add_action(
            "□",
            "Deselect all",
            [{ key: "A", modifier: true, shift: true, context: SHORTCUT_PRIORITY.Defer }],
            () => {
                ui.deselect();
            },
            true,
        );

        add_action(
            "⨉",
            "Delete",
            [
                { key: "Backspace", context: SHORTCUT_PRIORITY.Defer },
                { key: "Delete", context: SHORTCUT_PRIORITY.Defer },
            ],
            () => {
                ui.history.add(ui, [{
                    kind: "delete",
                    cells: ui.quiver.transitive_dependencies(ui.selection),
                }], true);
                ui.panel.update(ui);
            },
            true,
        );

        add_action(
            "⌖",
            "Centre view",
            [],
            () => {
                ui.centre_view();
            },
            true,
        );

        // Add the other, "invisible", shortcuts.

        add_shortcut([{ key: "Enter" }], () => {
            // Focus the label input.
            const input = ui.panel.element.querySelector('label input[type="text"]');
            input.focus();
            input.selectionStart = input.selectionEnd = input.value.length;
        });

        add_shortcut([{ key: "Escape", shift: null, context: SHORTCUT_PRIORITY.Always }], () => {
            // If an error banner is visible, the first thing Escape will do is dismiss the banner.
            if (UI.dismiss_error()) {
                return;
            }

            // Stop trying to connect cells.
            if (ui.in_mode(UIState.Connect)) {
                if (ui.state.forged_vertex) {
                    // If we created a vertex as part of the connection, we need to record
                    // that as an action.
                    const created = new Set([ui.state.source]);
                    ui.history.add(ui, [{
                        kind: "create",
                        cells: created,
                    }], false, ui.selection_excluding(created));
                }
                ui.switch_mode(UIState.default);
                // If we're connecting from an insertion point,
                // then we need to hide it again.
                ui.element.querySelector(".insertion-point").classList.remove("revealed");
            }
            // If we're waiting to start connecting a cell, then we stop waiting.
            const pending = ui.element.querySelector(".cell.pending");
            if (pending !== null) {
                pending.classList.remove("pending");
            }
            // Defocus the label input.
            const input = ui.input_is_active();
            if (input) {
                input.blur();
            }
            // Close any open panes.
            ui.panel.dismiss_export_pane(ui);
        });

        // Holding Option or Control triggers panning mode (and releasing ends panning mode).
        add_shortcut([
            { key: "Alt", context: SHORTCUT_PRIORITY.Always },
            { key: "Control", context: SHORTCUT_PRIORITY.Always },
        ], (event) => {
            if (ui.in_mode(UIState.Default)) {
                ui.switch_mode(new UIState.Pan(event.key));
            }
        }, null, (event) => {
            if (ui.in_mode(UIState.Pan) && ui.state.key === event.key) {
                ui.switch_mode(UIState.default);
            }
        });

        // Use the arrow keys for moving vertices around.
        add_shortcut([
            { key: "ArrowLeft" }, { key: "ArrowDown" }, { key: "ArrowRight" }, { key: "ArrowUp" },
        ], (event) => {
            let offset;
            switch (event.key) {
                case "ArrowLeft":
                    offset = new Position(-1, 0);
                    break;
                case "ArrowDown":
                    offset = new Position(0, 1);
                    break;
                case "ArrowRight":
                    offset = new Position(1, 0);
                    break;
                case "ArrowUp":
                    offset = new Position(0, -1);
                    break;
            }
            const vertices = Array.from(ui.selection).filter((cell) => cell.is_vertex());
            for (const vertex of vertices) {
                ui.positions.delete(`${vertex.position}`);
            }
            const all_new_positions_free = vertices.every((vertex) => {
                return !ui.positions.has(`${vertex.position.add(offset)}`);
            });
            for (const vertex of vertices) {
                ui.positions.set(`${vertex.position}`, vertex);
            }
            if (all_new_positions_free) {
                ui.history.add(ui, [{
                    kind: "move",
                    displacements: vertices.map((vertex) => ({
                        vertex,
                        from: vertex.position,
                        to: vertex.position.add(offset),
                    })),
                }], true);
            }
        });

        // Toggle the grid with `h`.
        add_shortcut([
            { key: "h" }
        ], () => {
            ui.grid.class_list.toggle("hidden");
        });

        // Handle global key presses (such as, but not exclusively limited to, keyboard shortcuts).
        const handle_shortcut = (type, event) => {
            // Many keyboard shortcuts are only relevant when we're not midway
            // through typing in an input, which should capture key presses.
            const editing_input = ui.input_is_active();

            // Trigger a "flash" animation on an element.
            const flash = (element) => {
                element.classList.remove("flash");
                // Removing a class and instantly adding it again is going to be ignored by
                // the browser, so we need to trigger a reflow to get the animation to
                // retrigger.
                void element.offsetWidth;
                element.classList.add("flash");
            };

            let key = event.key;
            // On Mac OS X, holding the Command key seems to override the usual capitalisation
            // modifier that holding Shift does. This is inconsistent with other operating systems,
            // so we override it manually here.
            if (event.shiftKey && /[a-z]/.test(key)) {
                key = key.toUpperCase();
            }

            if (shortcuts.has(key)) {
                for (const shortcut of shortcuts.get(key)) {
                    if (
                        (shortcut.shift === null || event.shiftKey === shortcut.shift)
                            && (shortcut.modifier === null
                                || (event.metaKey || event.ctrlKey) === shortcut.modifier
                                || ["Control", "Meta"].includes(key))
                    ) {
                        const effect = () => {
                            // Trigger the shortcut effect.
                            const action = shortcut[{ keydown: "action", keyup: "unaction" }[type]];
                            if (action !== null) {
                                action(event);
                                if (shortcut.button !== null) {
                                    // The button might be disabled by `action`, but we still want
                                    // to trigger the visual indication if it was enabled when
                                    // activated.
                                    if (!shortcut.button.element.disabled) {
                                        // Give some visual indication that the action has
                                        // been triggered.
                                        flash(shortcut.button.element);
                                    }
                                }
                            }
                        };

                        if (!editing_input && !ui.in_mode(UIState.Modal)
                            || shortcut.context === SHORTCUT_PRIORITY.Always)
                        {
                            event.preventDefault();
                            effect();
                        } else if (!ui.in_mode(UIState.Modal) && type === "keydown") {
                            // If we were editing an input, and the keyboard shortcut doesn't
                            // trigger in that case, then if the keyboard shortcut is deemed
                            // to have had no effect on the input, we either:
                            // (a) Trigger the keyboard shortcut effect (if the `context` is
                            //     `Defer`).
                            // (b) Trigger an animation on the input, to signal to the
                            //     user that the input is the one receiving the keyboard
                            //     shortcut.
                            const input = document.activeElement;
                            const [value, selectionStart, selectionEnd]
                                = [input.value, input.selectionStart,  input.selectionEnd];
                            setTimeout(() => {
                                if (input.value === value
                                    && input.selectionStart === selectionStart
                                    && input.selectionEnd === selectionEnd)
                                {
                                    if (shortcut.context === SHORTCUT_PRIORITY.Defer) {
                                        effect();
                                    } else {
                                        // Give some visual indication that the input stole the
                                        // keyboard focus.
                                        flash(input);
                                    }
                                }
                            }, 8);
                        }
                    }
                }
            }
        };

        // Handle global key presses and releases.
        for (const type of ["keydown", "keyup"]) {
            document.addEventListener(type, (event) => {
                handle_shortcut(type, event);
            });
        }
    }

    /// Update the toolbar (e.g. enabling or disabling buttons based on UI state).
    update(ui) {
        const enable_if = (name, condition) => {
            const element = this.element.querySelector(`.action[data-name="${name}"]`);
            element.disabled = !condition;
        };

        enable_if("Undo", ui.history.present !== 0);
        enable_if("Redo", ui.history.present < ui.history.actions.length);
        enable_if("Select all", ui.selection.size < ui.quiver.all_cells().length);
        enable_if("Deselect all", ui.selection.size > 0);
        enable_if("Delete", ui.selection.size > 0);
        enable_if("Centre view", ui.quiver.cells.length > 0 && ui.quiver.cells[0].size > 0);
    }
}

/// An k-cell (such as a vertex or edge). This object represents both the
/// abstract properties of the cell as well as their HTML representation.
class Cell {
    constructor(quiver, level, label = "") {
        /// The k for which this cell is an k-cell.
        this.level = level;

        /// The label with which the vertex or edge is annotated.
        this.label = label;

        /// Add this cell to the quiver.
        quiver.add(this);

        /// Elements are specialised depending on whether the cell is a vertex (0-cell) or edge.
        this.element = null;
    }

    /// Set up the cell's element with interaction events.
    initialise(ui) {
        this.element.classList.add("cell");

        const content_element = this.content_element;

        /// For cells with a separate `content_element`, we allow the cell to be moved
        /// by dragging its `element` (under the assumption it doesn't totally overlap
        /// its `content_element`).
        if (this.element !== content_element) {
            this.element.addEventListener("mousedown", (event) => {
                if (event.button === 0) {
                    if (ui.in_mode(UIState.Default)) {
                        event.stopPropagation();
                        // If the cell we're dragging is part of the existing selection,
                        // then we'll move every cell that is selected. However, if it's
                        // not already part of the selection, we'll just drag this cell
                        // and ignore the selection.
                        const move = new Set(ui.selection.has(this) ? [...ui.selection] : [this]);
                        ui.switch_mode(
                            new UIState.Move(
                                ui,
                                ui.position_from_event(event),
                                move,
                            ),
                        );
                    }
                }
            });
        }

        // We record whether a cell was already selected when we click on it, because
        // we only want to trigger a label input focus if we click on a cell that is
        // already selected. Clicking on an unselected cell should not focus the input,
        // or we wouldn't be able to immediately delete a cell with Backspace/Delete,
        // as the input field would capture it.
        let was_previously_selected = true;
        content_element.addEventListener("mousedown", (event) => {
            if (event.button === 0) {
                if (ui.in_mode(UIState.Default)) {
                    event.stopPropagation();
                    event.preventDefault();

                    was_previously_selected = !event.shiftKey && !event.metaKey && !event.ctrlKey
                        && ui.selection.has(this) &&
                        // If the label input is already focused, then we defocus it.
                        // This allows the user to easily switch between editing the
                        // entire cell and the label.
                        !ui.input_is_active();

                    if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                        // Deselect all other nodes.
                        ui.deselect();
                        ui.select(this);
                    } else {
                        // Toggle selection when holding Shift/Command/Control and clicking.
                        if (!ui.selection.has(this)) {
                            ui.select(this);
                        } else {
                            ui.deselect(this);
                        }
                    }

                    // We won't start a new connection immediately, because that will hide
                    // the toolbar prematurely. Instead, we'll add a `.pending` class, which
                    // will then convert to a connection if the mouse leaves the element
                    // while remaining held.
                    this.element.classList.add("pending");
                }
            }
        });

        content_element.addEventListener("mouseenter", () => {
            if (ui.in_mode(UIState.Connect)) {
                if (ui.state.source !== this) {
                    if (ui.state.valid_connection(this)) {
                        ui.state.target = this;
                        this.element.classList.add("target");
                        // Hide the insertion point (e.g. if we're connecting a vertex to an edge).
                        const insertion_point = ui.canvas.query_selector(".insertion-point");
                        insertion_point.classList.remove("revealed", "pending", "active");
                    }
                }
            }
        });

        content_element.addEventListener("mouseleave", () => {
            if (this.element.classList.contains("pending")) {
                this.element.classList.remove("pending");

                // Start connecting the node.
                const state = new UIState.Connect(ui, this, false);
                if (state.valid_connection(null)) {
                    ui.switch_mode(state);
                    this.element.classList.add("source");
                }
            }

            if (ui.in_mode(UIState.Connect)) {
                if (ui.state.target === this) {
                    ui.state.target = null;
                }
                // We may not have the "target" class, but we may attempt to remove it
                // regardless. We might still have the "target" class even if this cell
                // is not the target, if we've immediately transitioned from targeting
                // one cell to targeting another.
                this.element.classList.remove("target");
            }
        });

        content_element.addEventListener("mouseup", (event) => {
            if (event.button === 0) {
                // If we release the pointer without ever dragging, then
                // we never begin connecting the cell.
                this.element.classList.remove("pending");

                if (ui.in_mode(UIState.Default)) {
                    // Focus the label input for a cell if we've just ended releasing
                    // the mouse on top of the source.
                    if (was_previously_selected) {
                        ui.panel.element.querySelector('label input[type="text"]').focus();
                    }
                }

                if (ui.in_mode(UIState.Connect)) {
                    event.stopImmediatePropagation();
                    // Connect two cells if the source is different to the target.
                    if (ui.state.target === this) {
                        const actions = [];
                        const cells = new Set();

                        if (ui.state.forged_vertex) {
                            cells.add(ui.state.source);
                        }

                        if (ui.state.reconnect === null) {
                            // Create a new edge if we're not simply reconnecting an existing one.
                            const edge = ui.state.connect(ui, event);
                            cells.add(edge);
                        } else {
                            // Otherwise, reconnect the existing edge.
                            const { edge, end } = ui.state.reconnect;
                            actions.push({
                                kind: "connect",
                                edge,
                                end,
                                from: edge[end],
                                to: ui.state.target,
                            });
                            ui.state.connect(ui, event);
                        }

                        // If we haven't created any cells, then we don't need to
                        // record it in the history.
                        if (cells.size > 0) {
                            // We want to make sure `create` comes before `connect`, as
                            // order for history events is important, so we `unshift`
                            // here instead of `push`ing.
                            actions.unshift({
                                kind: "create",
                                cells,
                            });
                        }

                        // We might not have made a meaningful action (e.g. if we're tried
                        // connecting an edge to a node it's already connected to).
                        if (actions.length > 0) {
                            ui.history.add(ui, actions, false, ui.selection_excluding(cells));
                        }
                    }

                    ui.switch_mode(UIState.default);
                }
            }
        });

        // Add the cell to the UI canvas.
        ui.add_cell(this);
    }

    /// The main element of interaction for the cell. Not necessarily `this.element`, as children
    /// may override this getter.
    get content_element() {
        return this.element;
    }

    /// Whether this cell is an edge (i.e. whether its level is equal to zero).
    is_vertex() {
        return this.level === 0;
    }

    /// Whether this cell is an edge (i.e. whether its level is nonzero).
    is_edge() {
        return this.level > 0;
    }

    /// Returns either the position on the grid (if a vertex) or the offset (if an edge). `Position`
    /// and `Offset` have many of the same methods, so may be usually be used interchangeably in
    /// appropriate situations. If it is known that a cell is either a vertex or an edge, or if
    /// the two cases need to be handled differently, `.position` or `.offset` should be used
    /// directly.
    pos() {
        if (this.is_vertex()) {
            return this.position;
        } else {
            return this.offset;
        }
    }

    /// Returns the offset of the cell. Both vertices and edges are stored in absolute rather than
    /// view-relative co-ordinates, so both must be adjusted relative to the current view.
    /// However, the positions of vertices are stored as `Position`s, whereas the positions of
    /// edges are stored as `Offset`s, so these must be handled differently.
    off(ui) {
        if (this.is_vertex()) {
            return ui.centre_offset_from_position(this.position);
        } else {
            return this.offset;
        }
    }

    select() {
        this.element.classList.add("selected");
    }

    deselect() {
        this.element.classList.remove("selected");
    }

    size() {
        if (this.is_vertex()) {
            const label = this.element.querySelector(".label:not(.buffer)");
            return new Dimensions(label.offsetWidth, label.offsetHeight);
        } else {
            return Dimensions.zero();
        }
    }
}

/// 0-cells, or vertices. This is primarily specialised in its set up of HTML elements.
class Vertex extends Cell {
    constructor(ui, label = "", position) {
        super(ui.quiver, 0, label);

        this.position = position;
        this.render(ui);
        super.initialise(ui);
    }

    get content_element() {
        if (this.element !== null) {
            return this.element.querySelector(".content");
        } else {
            return null;
        }
    }

    /// Changes the vertex's position.
    /// This helper method ensures that column and row sizes are updated automatically.
    set_position(ui, position) {
        ui.cell_width_constraints.get(this.position.x).delete(this);
        ui.cell_height_constraints.get(this.position.y).delete(this);
        this.position = position;
    }

    /// Create the HTML element associated with the vertex.
    render(ui) {
        const construct = this.element === null;

        // The container for the cell.
        if (construct) {
            this.element = new DOM.Element("div").element;
        }

        // Position the vertex.
        const offset = ui.offset_from_position(this.position);
        offset.reposition(this.element);

        // Resize according to the grid cell.
        const cell_width = ui.cell_size(ui.cell_width, this.position.x);
        const cell_height = ui.cell_size(ui.cell_height, this.position.y);
        this.element.style.width = `${cell_width}px`;
        this.element.style.height = `${cell_height}px`;

        if (construct) {
            this.element.classList.add("vertex");

            // The cell content (containing the label).
            this.element.appendChild(new DOM.Element("div", { class: "content" }).element);
        }

        // Resize the content according to the grid cell. This is just the default size: it will be
        // updated by `render_label`.
        const content = this.content_element;
        content.style.width = `${ui.default_cell_size / 2}px`;
        content.style.left = `${cell_width / 2}px`;
        content.style.height = `${ui.default_cell_size / 2}px`;
        content.style.top = `${cell_height / 2}px`;

        if (construct) {
            this.render_label(ui);
        } else {
            // Ensure we re-render the label when the cell is moved, in case the cell it's moved
            // into is a different size.
            ui.panel.render_tex(ui, this);
        }
    }

    /// Create the HTML element associated with the label (and label buffer).
    /// This abstraction is necessary to handle situations where MathJax cannot
    /// be loaded gracefully.
    render_label(ui) {
        const content = new DOM.Element(this.content_element);
        // Create the label.
        content.add(ui.render_tex(this, UI.clear_label_for_cell(this), this.label));
        // Create an empty label buffer for flicker-free rendering.
        const buffer = ui.render_tex(this, UI.clear_label_for_cell(this, true), this.label);
        content.add(buffer);
    }

    /// Resize the cell content to match the label width.
    resize_content(ui, sizes) {
        const [width, height] = sizes;
        this.content_element.style.width
            = `${Math.max(ui.default_cell_size / 2, width + CONSTANTS.CONTENT_PADDING * 2)}px`;
        this.content_element.style.height
            = `${Math.max(ui.default_cell_size / 2, height + CONSTANTS.CONTENT_PADDING * 2)}px`;
    }
}

/// k-cells (for k > 0), or edges. This is primarily specialised in its set up of HTML elements.
class Edge extends Cell {
    constructor(ui, label = "", source, target, options) {
        super(ui.quiver, Math.max(source.level, target.level) + 1, label);

        this.options = Edge.default_options(options, null, this.level);

        this.reconnect(ui, source, target);

        super.initialise(ui);
    }

    /// A set of defaults for edge options: a basic arrow (→).
    static default_options(override_properties, override_style, level = 1) {
        let options = Object.assign({
            label_alignment: "left",
            offset: 0,
            style: Object.assign({
                name: "arrow",
                tail: { name: "none" },
                body: { level },
                head: { name: "arrowhead" },
            }, override_style),
        }, override_properties);

        if (typeof options.style.body.name === "undefined") {
            // Options may simply specify a level for the body,
            // in which case the default style is the cell.
            options.style.body.name = "cell";
        }

        return options;
    }

    /// Create the HTML element associated with the edge.
    render(ui, pointer_offset = null) {
        let [svg, background] = [null, null];

        if (this.element !== null) {
            // If an element already exists for the edge, then can mostly reuse it when
            // re-rendering it.
            svg = this.element.querySelector("svg:not(.background)");
            background = this.element.querySelector("svg.background");

            // Clear the SVGs: we're going to be completely redrawing it. We're going to keep
            // around any definitions, though, as we can effectively reuse them.
            for (const element of [svg, background]) {
                for (const child of Array.from(element.childNodes)) {
                    if (child.tagName !== "defs") {
                        child.remove();
                    }
                }
            }
        } else {
            // The container for the edge.
            this.element = new DOM.Element("div", { class: "edge" }, {
                // We want to make sure edges always display over vertices (and so on).
                // This means their handles are actually accessible.
                zIndex: this.level,
            }).element;

            // We allow users to reconnect edges to different cells by dragging their
            // endpoint handles.
            const reconnect = (event, end) => {
                event.stopPropagation();
                event.preventDefault();
                // We don't get the default blur behaviour, as we've prevented it, here, so
                // we have to do it ourselves.
                ui.panel.element.querySelector('label input[type="text"]').blur();

                this.element.classList.add("reconnecting");
                const fixed = { source: this.target, target: this.source }[end];
                ui.switch_mode(new UIState.Connect(ui, fixed, false, {
                    end,
                    edge: this,
                }));
            };

            // Create the background. We use an SVG rather than colouring the background
            // of the element so that we can curve it according to the edge shape.
            background = new DOM.SVGElement("svg", { class: "background" }).element;
            this.element.appendChild(background);

            // Create the endpoint handles.
            for (const end of ["source", "target"]) {
                const handle = new DOM.Element("div", { class: `handle ${end}` });
                handle.listen("mousedown", (event) => reconnect(event, end));
                this.element.appendChild(handle.element);
            }

            // The arrow SVG itself.
            svg = new DOM.SVGElement("svg").element;
            this.element.appendChild(svg);

            // The clear background for the label (for `centre` alignment).
            const defs = new DOM.SVGElement("defs")
            const mask = new DOM.SVGElement(
                "mask",
                {
                    id: `mask-${ui.unique_id(this)}`,
                    // Make sure the `mask` can affect `path`s.
                    maskUnits: "userSpaceOnUse",
                },
            );
            mask.add(new DOM.SVGElement(
                "rect",
                { width: "100%", height: "100%" },
                { fill: "white" },
            ));
            mask.add(
                new DOM.SVGElement("rect", {
                    class: "clear",
                    width: 0,
                    height: 0,
                }, {
                    fill: "black",
                    stroke: "none",
                })
            );
            defs.add(mask);
            svg.appendChild(defs.element);

            this.render_label(ui);
        }

        // If we're reconnecting an edge, then we vary its source/target (depending on
        // which is being dragged) depending on the pointer position. Thus, we need
        // to check what state we're currently in, and if we establish this edge is being
        // reconnected, we override the source/target position (as well as whether we offset
        // the edge endpoints).
        let [source_offset, target_offset] = [this.source.off(ui), this.target.off(ui)];
        let [source, target] = [this.source, this.target];
        const endpoint_offset = { source: true, target: true };
        const reconnecting = ui.in_mode(UIState.Connect)
            && ui.state.reconnect !== null
            && ui.state.reconnect.edge === this;
        if (reconnecting && pointer_offset !== null) {
            const connection_offset
                = ui.state.target !== null ? ui.state.target.off(ui) : pointer_offset;
            switch (ui.state.reconnect.end) {
                case "source":
                    source_offset = connection_offset;
                    source = ui.state.target || source;
                    break;
                case "target":
                    target_offset = connection_offset;
                    target = ui.state.target || target;
                    break;
            }
            if (ui.state.target === null) {
                // Usually we offset edge endpoints from the cells to which they are connected,
                // but when we are dragging an endpoint, we want to draw it right up to the pointer.
                endpoint_offset[ui.state.reconnect.end] = false;
            }
        }

        // Draw the edge itself.
        let [edge_offset, length, direction] = Edge.draw_and_position_edge(
            ui,
            this.element,
            svg,
            {
                offset: source_offset,
                size: source.size(),
                is_offset: endpoint_offset.source,
                level: source.level,
            },
            {
                offset: target_offset,
                size: target.size(),
                is_offset: endpoint_offset.target,
                level: target.level,
            },
            this.options,
            null,
            background,
        );

        // Set the edge's offset. This is important only for the cells that depend on this one,
        // so that they can be drawn between the correct positions.
        this.offset = edge_offset.add(new Offset(
            Math.cos(direction) * length / 2 + Math.cos(direction + Math.PI / 2)
                * CONSTANTS.EDGE_OFFSET_DISTANCE * this.options.offset,
            Math.sin(direction) * length / 2 + Math.sin(direction + Math.PI / 2)
                * CONSTANTS.EDGE_OFFSET_DISTANCE * this.options.offset,
        ));

        // Apply the mask to the edge.
        for (const path of svg.querySelectorAll("path")) {
            path.setAttribute("mask", `url(#mask-${ui.unique_id(this)})`);
        }
        // We only want to actually clear part of the edge if the alignment is `centre`.
        svg.querySelector(".clear").style.display
            = this.options.label_alignment === "centre" ? "inline" : "none";

        // If the label has already been rendered, then clear the edge for it.
        // If it has not already been rendered, this is a no-op: it will be called
        // again when the label is rendered.
        this.update_label_transformation(ui, target_offset.sub(source_offset).angle());
    }

    /// Create the HTML element associated with the label (and label buffer).
    /// This abstraction is necessary to handle situations where MathJax cannot
    /// be loaded gracefully.
    render_label(ui) {
        // Create the edge label.
        const label = ui.render_tex(
            this,
            UI.clear_label_for_cell(this),
            this.label,
            () => this.update_label_transformation(ui),
        );
        this.element.appendChild(label.element);
        // Create an empty label buffer for flicker-free rendering.
        const buffer = ui.render_tex(this, UI.clear_label_for_cell(this, true));
        this.element.appendChild(buffer.element);
    }

    /// Draw an edge on an existing SVG and positions it with respect to a parent `element`.
    /// Note that this does not clear the SVG beforehand.
    /// Returns the direction of the arrow.
    static draw_and_position_edge(
        ui,
        element,
        svg,
        source,
        target,
        options,
        gap,
        background = null,
    ) {
        // Constants for parameters of the arrow shapes.
        const SVG_PADDING = CONSTANTS.SVG_PADDING;
        const OFFSET_DISTANCE = CONSTANTS.EDGE_OFFSET_DISTANCE;
        // How much (vertical) space to give around the SVG.
        const EDGE_PADDING = 4;
        // The minimum length of the `element`. This is defined so that very small edges (e.g.
        // adjunctions or pullbacks) are still large enough to manipulate by clicking on them or
        // their handles.
        const MIN_LENGTH = 72;

        // The SVG for the arrow itself.

        const offset_delta = target.offset.sub(source.offset);
        const direction = Math.atan2(offset_delta.top, offset_delta.left);

        // Returns the distance from midpoint of the rectangle with the given `size` to any edge,
        // at the given `angle`.
        const edge_distance = (size, angle) => {
            const [h, v] = [size.width / Math.cos(angle), size.height / Math.sin(angle)]
                .map(Math.abs);
            return Number.isNaN(h) ? v : Number.isNaN(v) ? h : Math.min(h, v) / 2;
        };

        const padding = Dimensions.diag(CONSTANTS.CONTENT_PADDING * 2);
        // The content area of a vertex is reserved for vertices: edges will not encroach upon that
        // space.
        const min_margin = Dimensions.diag(ui.default_cell_size / 2);
        const margin = {
            source: source.is_offset ?
                edge_distance(source.size.add(padding).max(min_margin), direction) : 0,
            target: target.is_offset ?
                edge_distance(target.size.add(padding).max(min_margin), direction + Math.PI) : 0,
        };

        const length = Math.max(0, Math.hypot(offset_delta.top, offset_delta.left)
            - (margin.source + margin.target));

        // If the arrow has zero length, then we skip trying to draw it, as it's
        // obviously unnecessary, and can cause SVG errors from drawing invalid shapes.
        const { dimensions, alignment }
            = length > 0 ? Edge.draw_edge(svg, options, length, direction, gap, true)
                : { dimensions: Dimensions.zero(), alignment: "centre" };

        const clamped_width = Math.min(Math.max(dimensions.width, MIN_LENGTH), length);

        if (background !== null) {
            background.setAttribute("width", clamped_width);
            background.setAttribute("height", dimensions.height + EDGE_PADDING * 2);
            background.appendChild(new DOM.SVGElement("path", {
                d: `M 0 ${EDGE_PADDING + dimensions.height / 2} l ${clamped_width} 0`,
            }, {
                strokeWidth: `${dimensions.height + EDGE_PADDING * 2}px`,
            }).element);
        }

        // If the arrow is shorter than expected (for example, because we are using a
        // fixed-width arrow style), then we need to make sure that it's still centred
        // if the `alignment` is `"centre"`.
        const width_shortfall = length + SVG_PADDING * 2 - clamped_width;
        let margin_adjustment;
        switch (alignment) {
            case "left":
                margin_adjustment = 0;
                break;
            case "centre":
            case "over":
                margin_adjustment = 0.5;
                break;
            case "right":
                margin_adjustment = 1;
                break;
        }

        const margin_offset = margin.source + width_shortfall * margin_adjustment;

        // Transform the `element` so that the arrow points in the correct direction.
        element.style.left = `${source.offset.left + Math.cos(direction) * margin_offset}px`;
        element.style.top = `${source.offset.top + Math.sin(direction) * margin_offset}px`;
        [element.style.width, element.style.height]
            = new Offset(clamped_width, dimensions.height + EDGE_PADDING * 2).to_CSS();
        element.style.transformOrigin
            = `${SVG_PADDING}px ${dimensions.height / 2 + EDGE_PADDING}px`;
        element.style.transform = `
            translate(-${SVG_PADDING}px, -${dimensions.height / 2 + EDGE_PADDING}px)
            rotate(${direction}rad)
            translateY(${(options.offset || 0) * OFFSET_DISTANCE}px)
        `;

        return [new Offset(
            source.offset.left + Math.cos(direction) * margin_offset,
            source.offset.top + Math.sin(direction) * margin_offset,
        ), clamped_width, direction];
    }

    /// Draws an edge on an SVG. `length` must be nonnegative.
    /// Note that this does not clear the SVG beforehand.
    /// Returns the (new) dimensions of the SVG and the intended alignment of the edge.
    /// `{ dimensions, alignment }`
    static draw_edge(svg, options, length, direction, gap, scale = false) {
        // Constants for parameters of the arrow shapes.
        const SVG_PADDING = CONSTANTS.SVG_PADDING;
        // The width of each stroke (for the tail, body and head).
        const STROKE_WIDTH = 1.5;

        // Set up the standard styles used for arrows.
        Object.assign(svg.style, {
            fill: svg.style.fill || "none",
            stroke: svg.style.stroke || "black",
            strokeWidth: svg.style.strokeWidth || `${STROKE_WIDTH}px`,
            strokeLinecap: svg.style.strokeLinecap || "round",
            strokeLinejoin: svg.style.strokeLinejoin || "round",
        });

        // Default to 1-cells if no `level` is present (as for dashed and dotted lines.)
        const level = options.style.name === "arrow" && options.style.body.level || 1;
        // How much spacing to leave between lines for k-cells where k > 1.
        const SPACING = 6;
        // How wide each arrowhead should be (for a horizontal arrow).
        const HEAD_WIDTH = SPACING + (level - 1) * 2;
        // How tall each arrowhead should be (for a horizontal arrow).
        const HEAD_HEIGHT = (level + 1) * SPACING;
        // The space between each head.
        const HEAD_SPACING = 6;
        // The height of the vertical bar in the maps to tail.
        const TAIL_HEIGHT = SPACING * 2;

        // We scale the arrow head so that it transitions smoothly from nothing.
        const head_width = scale ? Math.min(length, HEAD_WIDTH) : HEAD_WIDTH;
        const head_height = HEAD_HEIGHT * (head_width / HEAD_WIDTH);

        // Adjust the arrow height for k-cells.
        const tail_height = TAIL_HEIGHT * (0.5 + level * 0.5);

        // Set up the SVG dimensions to fit the edge.
        let [width, height] = [0, 0];
        let alignment = "centre";

        // We do two passes over the tail/body/head styles.
        // First to calculate the dimensions and then to actually draw the edge.
        // This is necessary because we need to know the dimensions to centre things properly.
        const fit = (w, h) => [width, height] = [Math.max(width, w), Math.max(height, h)];

        // The number of arrowheads.
        let heads = 1;
        // How much to shorten the edge by, to make room for the tail.
        let shorten = 0;

        switch (options.style.name) {
            case "arrow":
                fit(length, Math.ceil(STROKE_WIDTH));

                switch (options.style.tail.name) {
                    case "maps to":
                        // The height of the vertical bar in the maps to tail.
                        const TAIL_HEIGHT = SPACING * 2;
                        // Adjust the arrow height for k-cells.
                        const tail_height = TAIL_HEIGHT * (0.5 + level * 0.5);
                        fit(Math.ceil(STROKE_WIDTH), tail_height);
                        break;
                    case "mono":
                        // The `"mono"` style simply draws an arrowhead for the tail.
                        fit(head_width, head_height);
                        shorten = head_width;
                        break;
                    case "hook":
                        // The hook width is the same as the arrowhead.
                        // We only need `head_width * 2` height (for
                        // 1-cells), but we need to double that to keep
                        // the arrow aligned conveniently in the middle.
                        fit(head_width, head_width * 4 + SPACING * (level - 1) / 2);
                        shorten = head_width;
                }

                switch (options.style.head.name) {
                    case "none":
                        heads = 0;
                        break;
                    case "epi":
                        heads = 2;
                    case "arrowhead":
                        fit(head_width * heads + HEAD_SPACING * (heads - 1), head_height);
                        break;
                    case "harpoon":
                        fit(head_width, head_height / 2);
                        break;
                }

                break;

            case "adjunction":
                // The dimensions of the bounding box of the ⊣ symbol.
                const [WIDTH, HEIGHT] = [16, 16];
                [width, height] = [WIDTH, HEIGHT];
                break;

            // Pullbacks/pushouts.
            case "corner":
                // The dimensions of the bounding box of the ⌟ symbol.
                const SIZE = 12;
                [width, height] = [SIZE, SIZE * 2];
                // We want to draw the symbol next to the vertex from which it is drawn.
                alignment = "left";
                break;
        }

        // Now actually draw the edge.

        switch (options.style.name) {
            case "arrow":
                // When drawing asymmetric arrowheads (such as harpoons), we need to
                // draw the arrowhead at the lowermost line, so we need to adjust the
                // y position.
                const asymmetry_offset
                    = options.style.head.name === "harpoon" ? (level - 1) * SPACING / 2 : 0;

                // A function for finding the width of an arrowhead at a certain y position,
                // so that we can draw multiple lines to a curved arrow head perfectly.
                const head_x = (y, tail = false) => {
                    if (head_height === 0 || !tail && options.style.head.name === "none") {
                        return 0;
                    }

                    // Currently only arrowheads drawn for heads may be asymmetric.
                    const asymmetry_adjustment = !tail ? asymmetry_offset : 0;
                    // We have to be careful to adjust for asymmetry, which affects the dimensions
                    // of the arrowheads.
                    const asymmetry_sign
                        = asymmetry_adjustment !== 0
                            ? { top: 1, bottom: -1 }[options.style.head.side]
                            : 0;

                    return (head_width + asymmetry_adjustment)
                        * (1 - (1 - 2 * Math.abs(y - asymmetry_offset * asymmetry_sign)
                            / (head_height + asymmetry_adjustment)) ** 2)
                        ** 0.5;
                };

                if (options.style.body.name !== "none") {
                    // Draw all the lines.
                    for (let i = 0; i < level; ++i) {
                        let y = (i + (1 - level) / 2) * SPACING;
                        // This guard condition is necessary simply for very short edges.
                        if (Math.abs(y) <= head_height / 2) {
                            // If the tail is drawn as a head, as is the case with `"mono"`,
                            // then we need to shift the lines instead of simply shortening
                            // them.
                            const tail_head_adjustment
                                = options.style.tail.name === "mono" ? head_x(y, true) : 0;
                            const path
                                = [`M ${SVG_PADDING + shorten - tail_head_adjustment} ${
                                    SVG_PADDING + height / 2 + y
                                }`];
                            // When drawing multiple heads and multiple lines, it looks messy
                            // if the heads intersect the lines, so in this case we draw the
                            // lines to the leftmost head. For 1-cells, it looks better if
                            // heads do intersect the lines.
                            const level_heads_adjustment
                                = level > 1 ? (heads - 1) * HEAD_SPACING : 0;
                            const line_length = length - shorten - head_x(y)
                                - level_heads_adjustment + tail_head_adjustment;

                            if (options.style.body.name === "squiggly") {
                                // The height of each triangle from the edge.
                                const AMPLITUDE = 2;
                                // Flat padding at the start of the edge (measured in
                                // triangles).
                                const PADDING = 1;
                                // Twice as much padding is given at the end, plus extra
                                // if there are multiple heads.
                                const head_padding = PADDING + PADDING * heads;

                                path.push(`l ${AMPLITUDE * 2 * PADDING} 0`);
                                for (
                                    let l = AMPLITUDE * 2 * PADDING, flip = 1;
                                    l < line_length - AMPLITUDE * 2 * head_padding;
                                    l += AMPLITUDE * 2, flip = -flip
                                ) {
                                    path.push(`l ${AMPLITUDE} ${AMPLITUDE * flip}`);
                                    path.push(`l ${AMPLITUDE} ${AMPLITUDE * -flip}`);
                                }
                                path.push(`L ${SVG_PADDING + line_length + shorten} ${
                                    SVG_PADDING + height / 2 + y
                                }`);
                            } else {
                                path.push(`l ${line_length} 0`);
                            }

                            const line = new DOM.SVGElement("path", { d: path.join(" ") }).element;

                            // Dashed and dotted lines.
                            switch (options.style.body.name) {
                                case "dashed":
                                    line.style.strokeDasharray = "6";
                                    break;
                                case "dotted":
                                    line.style.strokeDasharray = "1 4";
                                    break;
                            }

                            // Explicit gaps.
                            if (gap !== null) {
                                line.style.strokeDasharray
                                    = `${(length - gap.length) / 2}, ${gap.length}`;
                                line.style.strokeDashoffset = gap.offset;
                            }

                            svg.appendChild(line);
                        }
                    }
                }

                // This function has been extracted because it is actually used to draw
                // both arrowheads (in the usual case) and tails (for `"mono"`).
                const draw_arrowhead = (x, tail = false, top = true, bottom = true) => {
                    // Currently only arrowheads drawn for heads may be asymmetric.
                    const asymmetry_adjustment = !tail ? asymmetry_offset : 0;

                    svg.appendChild(new DOM.SVGElement("path", {
                        d: (top ? `
                            M ${SVG_PADDING + x} ${SVG_PADDING + height / 2 + asymmetry_adjustment}
                            a ${head_width + asymmetry_adjustment}
                                ${head_height / 2 + asymmetry_adjustment} 0 0 1
                                -${head_width + asymmetry_adjustment}
                                -${head_height / 2 + asymmetry_adjustment}
                        ` : "") + (bottom ? `
                            M ${SVG_PADDING + x} ${SVG_PADDING + height / 2 - asymmetry_adjustment}
                            a ${head_width + asymmetry_adjustment}
                                ${head_height / 2 + asymmetry_adjustment} 0 0 0
                                -${head_width + asymmetry_adjustment}
                                ${head_height / 2 + asymmetry_adjustment}
                        ` : "").trim().replace(/\s+/g, " ")
                    }).element);
                };

                // Draw the arrow tail.
                switch (options.style.tail.name) {
                    case "maps to":
                        svg.appendChild(new DOM.SVGElement("path", {
                            d: `
                                M ${SVG_PADDING} ${SVG_PADDING + (height - tail_height) / 2}
                                l 0 ${tail_height}
                            `.trim().replace(/\s+/g, " ")
                        }).element);
                        break;

                    case "mono":
                        draw_arrowhead(head_width, true);
                        break;

                    case "hook":
                        for (let i = 0; i < level; ++i) {
                            let y = (i + (1 - level) / 2) * SPACING;
                            const flip = options.style.tail.side === "top" ? 1 : -1;
                            svg.appendChild(new DOM.SVGElement("path", {
                                d: `
                                    M ${SVG_PADDING + head_width}
                                        ${SVG_PADDING + height / 2 + y}
                                    a ${head_width} ${head_width} 0 0 ${flip === 1 ? 1 : 0} 0
                                        ${-head_width * 2 * flip}
                                `.trim().replace(/\s+/g, " ")
                            }).element);
                        }
                        break;
                }

                // Draw the arrow head.
                switch (options.style.head.name) {
                    case "arrowhead":
                    case "epi":
                        for (let i = 0; i < heads; ++i) {
                            draw_arrowhead(width - i * HEAD_SPACING);
                        }
                        break;

                    case "harpoon":
                        const top = options.style.head.side === "top";
                        draw_arrowhead(width, false, top, !top);
                        break;
                }

                break;

            case "adjunction":
                // Draw the ⊣ symbol. The dimensions have already been set up for us
                // in the previous step.
                svg.appendChild(new DOM.SVGElement("path", {
                    d: `
                        M ${SVG_PADDING} ${SVG_PADDING + height / 2}
                        l ${width} 0
                        m 0 ${-height / 2}
                        l 0 ${height}
                    `.trim().replace(/\s+/g, " ")
                }).element);

                break;

            case "corner":
                // Draw the ⌟ symbol. The dimensions have already been set up for us
                // in the previous step.
                const side = width / 2 ** 0.5;
                // Round the angle to the nearest 45º and adjust with respect to the
                // current direction.
                const PI_4 = Math.PI / 4;
                const angle = Math.PI + PI_4 * Math.round(4 * direction / Math.PI) - direction;
                svg.appendChild(new DOM.SVGElement("path", {
                    d: `
                        M ${SVG_PADDING + width} ${SVG_PADDING + width}
                        l ${Math.cos(angle - PI_4) * side} ${Math.sin(angle - PI_4) * side}
                        M ${SVG_PADDING + width} ${SVG_PADDING + width}
                        l ${Math.cos(angle + PI_4) * side} ${Math.sin(angle + PI_4) * side}
                    `.trim().replace(/\s+/g, " ")
                }).element);

                break;
        }

        svg.setAttribute("width", width + SVG_PADDING * 2);
        svg.setAttribute("height", height + SVG_PADDING * 2);

        return {
            dimensions: new Dimensions(width + SVG_PADDING * 2, height + SVG_PADDING * 2),
            alignment,
        };
    }

    /// Returns the angle of this edge.
    angle(ui) {
        return this.target.off(ui).sub(this.source.off(ui)).angle();
    }

    /// Update the `label` transformation (translation and rotation) as well as
    /// the edge clearing size for `centre` alignment in accordance with the
    /// dimensions of the label.
    update_label_transformation(ui, angle = this.angle(ui)) {
        const label = this.element.querySelector(".label:not(.buffer)");

        // Bound an `angle` to [0, π/2).
        const bound_angle = (angle) => {
            return Math.PI / 2 - Math.abs(Math.PI / 2 - ((angle % Math.PI) + Math.PI) % Math.PI);
        };

        // How much to offset the label from the edge.
        const LABEL_OFFSET = 16;
        let label_offset;
        switch (this.options.label_alignment) {
            case "left":
                label_offset = -1;
                break;
            case "centre":
            case "over":
                label_offset = 0;
                break;
            case "right":
                label_offset = 1;
                break;
        }

        // Expand or shrink the label to fit the available space.
        ui.resize_label(this, label);

        // Reverse the rotation for the label, so that it always displays upright and offset it
        // so that it is aligned correctly.
        label.style.transform = `
            translate(-50%, -50%)
            translateY(${
                (Math.sin(bound_angle(angle)) * label.offsetWidth / 2 + LABEL_OFFSET) * label_offset
            }px)
            rotate(${-angle}rad)
        `;

        // Make sure the buffer is formatted identically to the label.
        this.element.querySelector(".label.buffer").style.transform = label.style.transform;

        // Get the length of a line through the centre of the bounds rectangle at an `angle`.
        const angle_length = (angle) => {
            // Cut a rectangle out of the edge to leave room for the label text.
            // How much padding around the label to give (cut out of the edge).
            const CLEAR_PADDING = 4;

            return (Math.min(
                label.offsetWidth / (2 * Math.cos(bound_angle(angle))),
                label.offsetHeight / (2 * Math.sin(bound_angle(angle))),
            ) + CLEAR_PADDING) * 2;
        };

        const [width, height]
            = label.offsetWidth > 0 && label.offsetHeight > 0 ?
                [angle_length(angle), angle_length(angle + Math.PI / 2)]
            : [0, 0];

        new DOM.SVGElement(this.element.querySelector("svg mask .clear"), {
            x: label.offsetLeft - width / 2,
            y: label.offsetTop - height / 2,
            width,
            height,
        });
    }

    /// Changes the source and target.
    reconnect(ui, source, target) {
        [this.source, this.target] = [source, target];
        ui.quiver.connect(source, target, this);
        for (const cell of ui.quiver.transitive_dependencies([this])) {
            cell.render(ui);
        }
    }

    /// Reverses the edge, swapping the `source` and `target`.
    reverse(ui) {
        // Flip all the dependency relationships.
        for (const cell of ui.quiver.reverse_dependencies_of(this)) {
            const dependencies = ui.quiver.dependencies.get(cell);
            dependencies.set(
                this,
                { source: "target", target: "source" }[dependencies.get(this)],
            );
        }

        // Reverse the label alignment and edge offset as well as any oriented styles.
        // Note that since we do this, the position of the edge will remain the same, which means
        // we don't need to rerender any of this edge's dependencies.
        this.options.label_alignment = {
            left: "right",
            centre: "centre",
            over: "over",
            right: "left",
        }[this.options.label_alignment];
        this.options.offset = -this.options.offset;
        if (this.options.style.name === "arrow") {
            const swap_sides = { top: "bottom", bottom: "top" };
            if (this.options.style.tail.name === "hook") {
                this.options.style.tail.side = swap_sides[this.options.style.tail.side];
            }
            if (this.options.style.head.name === "harpoon") {
                this.options.style.head.side = swap_sides[this.options.style.head.side];
            }
        }

        // Swap the `source` and `target`.
        [this.source, this.target] = [this.target, this.source];

        this.render(ui);
    }
}

// Which library to use for rendering labels.
const RENDER_METHOD = "KaTeX";

// We want until the (minimal) DOM content has loaded, so we have access to `document.body`.
document.addEventListener("DOMContentLoaded", () => {
    // We don't want the browser being too clever and trying to restore the scroll position, as that
    // won't play nicely with the auto-centring.
    if ("scrollRestoration" in window.history) {
        window.history.scrollRestoration = "manual";
    }

    // The global UI.
    let ui = new UI(document.body);
    ui.initialise();

    const load_quiver_from_query_string = () => {
        // Get the query string (i.e. the part of the URL after the "?").
        const query_string = window.location.href.match(/\?(.*)$/);
        if (query_string !== null) {
            // If there is a query string, try to decode it as a diagram.
            try {
                const query_segs = query_string[1].split("&");
                const query_data = new Map( query_segs.map(segment => segment.split("=")));
                // Decode the diagram.
                if (query_data.has("q")) {
                    QuiverImportExport.base64.import(ui, query_data.get("q"));
                } else {
                    // In earlier versions of quiver, we also supported URLs without the `q` key.
                    // This may eventually be deprecated.
                    QuiverImportExport.base64.import(ui, query_segs[0]);
                }
                // If there is a `macro_url`, load the macros from it.
                if (query_data.has("macro_url")) {
                    ui.load_macros_from_url(decodeURIComponent(query_data.get("macro_url")));
                }
            } catch (error) {
                if (ui.quiver.is_empty()) {
                    UI.display_error("The saved diagram was malformed and could not be loaded.");
                } else {
                    // The importer will try to recover from errors, so we may have been mostly
                    // successful.
                    UI.display_error(
                        "The saved diagram was malformed and may have been loaded incorrectly."
                    );
                }
                // Rethrow the error so that it can be reported.
                throw error;
            }
        }
    };

    // Immediately load the rendering library.
    if (RENDER_METHOD !== null) {
        // All non-`null` rendering libraries add some script.
        const rendering_library = new DOM.Element("script", {
            type: "text/javascript",
            src: {
                MathJax: "MathJax/MathJax.js",
                KaTeX: "KaTeX/dist/katex.js",
            }[RENDER_METHOD],
        }).listen("load", () => {
            ui.activate_render_method(RENDER_METHOD);

            // We delay loading the quiver when using KaTeX (see comment below),
            // so as soon as the library is loaded, we want to load the quiver.
            if (RENDER_METHOD === "KaTeX") {
                load_quiver_from_query_string();
            }
        }).listen("error", () => {
            // Handle MathJax or KaTeX not loading (somewhat) gracefully.
            UI.display_error(`${RENDER_METHOD} failed to load.`)
        });

        // Specific, per-library behaviour.
        switch (RENDER_METHOD) {
            case "MathJax":
                window.MathJax = {
                    jax: ["input/TeX", "output/SVG"],
                    extensions: ["tex2jax.js", "TeX/noErrors.js", "TeX/noUndefined.js"],
                    messageStyle: "none",
                    skipStartupTypeset: true,
                    positionToHash: false,
                    showMathMenu: false,
                    showMathMenuMSIE: false,
                    TeX: {
                        noErrors: {
                            multiLine: false,
                            style: {
                                border: "none",
                                font: "20px monospace",
                                color: "hsl(0, 100%, 40%)",
                            },
                        },
                        noUndefined: {
                            attributes: {
                                mathcolor: "hsl(0, 100%, 40%)",
                                mathsize: "90%",
                                mathfont: "monospace",
                            }
                        },
                    },
                };
                break;
            case "KaTeX":
                document.head.appendChild(new DOM.Element("link", {
                    rel: "stylesheet",
                    href: "KaTeX/dist/katex.css",
                }).element);
                // Preload various fonts to avoid flashes of unformatted text.
                const preload_fonts = ["Main-Regular", "Math-Italic"];
                for (const font of preload_fonts) {
                    document.head.appendChild(new DOM.Element("link", {
                        rel: "preload",
                        href: `KaTeX/dist/fonts/KaTeX_${font}.woff2`,
                        as: "font",
                    }).element);
                }
                break;
        }

        // Trigger the script load.
        document.head.appendChild(rendering_library.element);
    }

    // KaTeX is special in that it's fast enough to be worth waiting for, but not
    // immediately available. In this case, we delay loading the quiver until the
    // library has loaded.
    if (RENDER_METHOD !== "KaTeX") {
        load_quiver_from_query_string();
    }
});
