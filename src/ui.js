"use strict";

/// Various parameters.
Object.assign(CONSTANTS, {
    /// We currently only support 0-cells, 1-cells, 2-cells, and 3-cells. This is due to
    /// a restriction with tikz-cd, which does not support n-cells greater than n = 2 (though it has
    /// issues even then), and also for usability: a user is unlikely to want to draw a higher cell.
    /// This restriction is not technical: it can be lifted in the editor without issue.
    MAXIMUM_CELL_LEVEL: 3,
    /// The width of the dashed grid lines.
    GRID_BORDER_WIDTH: 2,
    /// The padding of the content area of a vertex.
    CONTENT_PADDING: 8,
    /// How much (horizontal and vertical) space (in pixels) in the SVG to give around the arrow
    /// (to account for artefacts around the drawing).
    SVG_PADDING: 6,
    // How much space (in pixels) to leave between adjacent parallel arrows.
    EDGE_OFFSET_DISTANCE: 8,
    // How many pixels each unit of curve height corresponds to.
    CURVE_HEIGHT: 24,
    // How many pixels of padding to place around labels on edges.
    EDGE_LABEL_PADDING: 8,
});

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

        // The source of a connection between two cells.
        this.source = source;

        // The target of a connection between two cells.
        this.target = null;

        // Whether the source of this connection was created with the start
        // of the connection itself (i.e. a vertex was created after dragging
        // from an empty grid cell).
        this.forged_vertex = forged_vertex;

        // If `reconnect` is not null, then we're reconnecting an existing edge.
        // In that case, rather than drawing a phantom arrow, we'll actually
        // reposition the existing edge.
        // `reconnect` is of the form `{ edge, end }` where `end` is either
        // `"source"` or `"target"`.
        this.reconnect = reconnect;

        if (this.reconnect === null) {
            // The overlay for drawing an edge between the source and the cursor.
            this.overlay = new DOM.Element("div", { class: "overlay" });
            this.arrow = new Arrow(
                new Shape.Endpoint(Point.zero()),
                new Shape.Endpoint(Point.zero()),
            );
            this.overlay.add(this.arrow.element);
            ui.canvas.add(this.overlay);
        } else {
            this.reconnect.edge.element.class_list.add("reconnecting");
        }
    }

    release(ui) {
        this.source.element.class_list.remove("source");
        if (this.target !== null) {
            this.target.element.class_list.remove("target");
            this.target = null;
        }
        // If we're connecting from an insertion point, then we need to hide it again.
        ui.element.query_selector(".insertion-point").class_list.remove("revealed");
        if (this.reconnect === null) {
            this.overlay.remove();
            this.arrow = null;
        } else {
            this.reconnect.edge.element.class_list.remove("reconnecting");
            for (const cell of ui.quiver.transitive_dependencies([this.reconnect.edge])) {
                cell.render(ui);
            }
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
            svg.clear();
            // Lock on to the target if present, otherwise simply draw the edge
            // to the position of the cursor.
            const target = this.target !== null ? {
                shape: this.target.shape,
                level: this.target.level,
            } : {
                shape: new Shape.Endpoint(offset),
                level: 0,
            };

            this.arrow.source = this.source.shape;
            this.arrow.target = target.shape;
            const level = Math.max(this.source.level, target.level) + 1;
            this.arrow.style = UI.arrow_style_for_options(
                this.arrow,
                Edge.default_options({
                    level,
                    length: level === 1 ? 100 : 70,
                }),
            );
            this.arrow.redraw();
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
    valid_connection(ui, target) {
        // To allow `valid_connection` to be used to simply check whether the source is valid,
        // we ignore source--target compatibility if `target` is null.
        // We allow cells to be connected even if they do not have the same level. This is
        // because it's often useful when drawing diagrams, even if it may not always be
        // semantically valid.
        const source_target_level = Math.max(this.source.level, target === null ? 0 : target.level);
        if (source_target_level + 1 > CONSTANTS.MAXIMUM_CELL_LEVEL) {
            return false;
        }

        if (this.reconnect === null) {
            // If there are no edges depending on this one, then there are no other obstructions to
            // being connectable.
            return true;
        } else {
            // We need to check that the dependencies also don't have too great a level after
            // reconnecting.
            // We're going to temporarily increase the level of the edge to what it would be,
            // and check for any edges that then exceed the `MAXIMUM_CELL_LEVEL`. This is
            // conceptually the simplest version of the check.
            const edge_level = this.reconnect.edge.level;
            this.reconnect.edge.level = source_target_level + 1;

            let exceeded_max_level = false;

            const update_levels = () => {
                for (const cell of ui.quiver.transitive_dependencies([this.reconnect.edge], true)) {
                    if (target === cell) {
                        // We shouldn't be able to connect to an edge that's connected to this one.
                        exceeded_max_level = true;
                        break;
                    }
                    cell.level = Math.max(cell.source.level, cell.target.level) + 1;
                    if (cell.level > CONSTANTS.MAXIMUM_CELL_LEVEL) {
                        exceeded_max_level = true;
                        break;
                    }
                }
            };

            // Check for violations of `MAXIMUM_CELL_LEVEL`.
            update_levels();
            // Reset the edge level.
            this.reconnect.edge.level = edge_level;
            // Reset the levels of its dependencies.
            update_levels();
            
            return !exceeded_max_level;
        }
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
                // By default, 2-cells and above have a little padding for aesthetic purposes.
                length: Math.max(this.source.level, this.target.level) === 0 ? 100 : 70,
                // We will guess the label alignment below, but in case there's no selected label
                // alignment, we default to "left".
                label_alignment: "left",
                // The default settings for the other options are fine.
            };
            const selected_alignment
                = ui.panel.element.query_selector('input[name="label-alignment"]:checked');
            if (selected_alignment !== null) {
                // If multiple edges are selected and not all selected edges have the same label
                // alignment, there will be no checked input.
                options.label_alignment = selected_alignment.element.value;
            }
            // If *every* existing connection to source and target has a consistent label alignment,
            // then `align` will be a singleton, in which case we use that element as the alignment.
            // If it has `left` and `right` in equal measure (regardless of `centre`), then
            // we will pick `centre`. Otherwise we keep the default. And similarly for `offset` and
            // `curve`.
            const align = new Map();
            const offset = new Map();
            const curve = new Map();
            // We only want to pick `centre` when the source and target are equally constraining
            // (otherwise we end up picking `centre` far too often). So we check that they're both
            // being considered equally. This means `centre` is chosen only rarely, but often in
            // the situations you want it. (This has no analogue in `offset` or `curve`.)
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
                    curve: -options.curve,
                };
            };

            const conserve = (options, between) => {
                return {
                    label_alignment: options.label_alignment,
                    // We ignore the offsets and curves of edges that aren't directly `between` the
                    // source and target.
                    offset: between ? options.offset : null,
                    curve: between ? options.curve : null,
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
                if (options.curve !== null) {
                    if (!curve.has(options.curve)) {
                        curve.set(options.curve, 0);
                    }
                    curve.set(options.curve, curve.get(options.curve) + 1);
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
            if (curve.size === 1) {
                options.curve = curve.keys().next().value;
            }

            if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                ui.deselect();
            }
            const label = "";
            // The edge itself does all the set up, such as adding itself to the page.
            const edge = new Edge(ui, label, this.source, this.target, options);
            ui.select(edge);
            if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                ui.panel.element.query_selector('label input[type="text"]')
                    .element.focus();
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

        /// Whether to prevent relayout for individual cell changes so as to batch it instead.
        this.buffer_updates = false;

        /// The offset of the view (i.e. the centre of the view).
        this.view = Offset.zero();

        /// The scale of the view, as a log of 2. E.g. `scale = 0` is normal, `scale = 1` is 2x
        /// zoom, `scale = -1` is 0.5x and so on.
        this.scale = 0;

        /// The size of the view (i.e. the document body dimensions).
        this.dimensions = new Dimensions(document.body.offsetWidth, document.body.offsetHeight);

        /// Undo/redo for actions.
        this.history = new History();

        /// The panel for viewing and editing cell data.
        this.panel = new Panel();

        /// The toolbar.
        this.toolbar = new Toolbar();

        /// LaTeX macro definitions.
        this.macros = new Map();

        /// The URL from which the macros have been fetched (if at all).
        this.macro_url = null;
    }

    initialise() {
        this.element.class_list.add("ui");
        this.switch_mode(UIState.default);

        // Set the grid background.
        this.initialise_grid(this.element);

        // Set up the element containing all the cells.
        this.container = new DOM.Element("div", { class: "container" }).add_to(this.element);
        this.canvas = new DOM.Element("div", { class: "canvas" }).add_to(this.container);

        // Set up the panel for viewing and editing cell data.
        this.panel.initialise(this);
        this.element.add(this.panel.element);

        // Set up the toolbar.
        this.toolbar.initialise(this);
        this.element.add(this.toolbar.element);

        // Add the logo.
        this.element.add(
            new DOM.Element("a", { href: "https://github.com/varkor/quiver", target: "_blank" })
                .add(new DOM.Element("img", { src: "quiver.svg", class: "logo" }))
        );

        // Add the insertion point for new nodes.
        const insertion_point = new DOM.Element("div", { class: "insertion-point" })
            .add_to(this.canvas);

        // Handle panning via scrolling.
        window.addEventListener("wheel", (event) => {
            // We don't want to scroll while using the mouse wheel.
            event.preventDefault();

            // Hide the insertion point if it is visible.
            insertion_point.class_list.remove("revealed");

            this.pan_view(new Offset(
                event.deltaX * 2 ** -this.scale,
                event.deltaY * 2 ** -this.scale,
            ));
        }, { passive: false });

        // The canvas is only as big as the window, so we need to resize it when the window resizes.
        window.addEventListener("resize", () => {
            // Adjust the grid so that it aligns with the content.
            this.update_grid();
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
        this.element.listen("mouseleave", () => {
            if (this.in_mode(UIState.Move)) {
                commit_move_event();
                this.switch_mode(UIState.default);
            }
        });

        this.element.listen("mousedown", (event) => {
            if (event.button === 0) {
                // Usually, if `Alt` or `Control` have been held we will have already switched to
                // the Pan mode. However, if the window is not in focus, they will not have been
                // detected, so we switch modes on mouse click.
                if (this.in_mode(UIState.Default)) {
                    if (event.altKey) {
                        this.switch_mode(new UIState.Pan("Alt"));
                    } else if (event.ctrlKey) {
                        this.switch_mode(new UIState.Pan("Control"));
                    }
                }
                if (this.in_mode(UIState.Pan)) {
                    // Hide the insertion point if it is visible.
                    insertion_point.class_list.remove("revealed");
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
                        this.panel.element.query_selector('label input[type="text"]')
                            .element.blur();
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
            const height =
                this.cell_size(this.cell_height, position.y) - CONSTANTS.GRID_BORDER_WIDTH;
            insertion_point.set_style({
                left: `${offset.x}px`,
                top: `${offset.y}px`,
                // Resize the insertion point appropriately for the grid cell.
                width: `${
                    this.cell_size(this.cell_width, position.x) - CONSTANTS.GRID_BORDER_WIDTH}px`,
                height: `${height}px`,
                lineHeight: `${height}px`,
            });
            return position;
        };

        // Clicking on the insertion point reveals it, after which another click adds a new node.
        insertion_point.listen("mousedown", (event) => {
            if (event.button === 0) {
                if (this.in_mode(UIState.Default)) {
                    event.preventDefault();
                    if (!insertion_point.class_list.contains("revealed")) {
                        // Reveal the insertion point upon a click.
                        reposition_insertion_point(event);
                        insertion_point.class_list.add("revealed", "pending");
                    } else {
                        // We only stop propagation in this branch, so that clicking once in an
                        // empty grid cell will deselect any selected cells, but clicking a second
                        // time to add a new vertex will not deselect the new, selected vertex we've
                        // just added. Note that it's not possible to select other cells in between
                        // the first and second click, because leaving the grid cell with the cursor
                        // (to select other cells) hides the insertion point again.
                        event.stopPropagation();
                        insertion_point.class_list.remove("revealed");
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
                            this.panel.element.query_selector('label input[type="text"]')
                                .element.select();
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
        insertion_point.listen("mousemove", () => {
            if (insertion_point.class_list.contains("pending")) {
                insertion_point.class_list.remove("pending");
                insertion_point.class_list.add("active");
            }
        });

        // If we release the mouse while hovering over the insertion point, there are two
        // possibilities. Either we haven't moved the mouse, in which case the insertion point loses
        // its `"pending"` or `"active"` state; or we have, in which case we're mid-connection and
        // we need to create a new vertex and connect it. We add the event listener to the
        // container, rather than the insertion point, so that we don't have to worry about the
        // insertion point being exactly the same size as a grid cell (there is some padding for
        // aesthetic purposes) or the insertion point being covered by other elements (like edge
        // endpoints).
        this.container.listen("mouseup", (event) => {
            if (event.button === 0) {
                // Handle mouse releases without having moved the cursor from the initial cell.
                insertion_point.class_list.remove("pending", "active");

                // We only want to create a connection if the insertion point is visible. E.g. not
                // if we're hovering over a grid cell that contains a vertex, but not hovering over
                // the vertex itself (i.e. the whitespace around the vertex).
                if (insertion_point.class_list.contains("revealed")) {
                    // When releasing the mouse over an empty grid cell, we want to create a new
                    // cell and connect it to the source.
                    if (this.in_mode(UIState.Connect)) {
                        event.stopImmediatePropagation();
                        // We only want to forge vertices, not edges (and thus 1-cells).
                        if (this.state.source.is_vertex()) {
                            this.state.target = create_vertex(this.position_from_event(event));
                            // Usually this vertex will be immediately deselected, except when Shift
                            // is held, in which case we want to select the forged vertices *and*
                            // the new edge.
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
                                // Unless we're holding Shift/Command/Control (in which case we just
                                // add the new vertex to the selection) we want to focus and select
                                // the new vertex.
                                const { edge, end } = this.state.reconnect;
                                if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                                    this.deselect();
                                    this.select(this.state.target);
                                    this.panel.element.query_selector('label input[type="text"]')
                                        .element.select();
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

                            this.history.add(
                                this,
                                actions,
                                false,
                                this.selection_excluding(created),
                            );
                        }
                        this.switch_mode(UIState.default);
                    }
                }
            }
        });

        // If the cursor leaves the insertion point and the mouse has *not*
        // been held, it gets hidden again. However, if the cursor leaves the
        // insertion point whilst remaining held, then the insertion point will
        // be `"active"` and we create a new vertex and immediately start
        // connecting it to something (possibly an empty grid cell, which will
        // create a new vertex and connect them both).
        insertion_point.listen("mouseleave", () => {
            insertion_point.class_list.remove("pending");

            if (insertion_point.class_list.contains("active")) {
                // If the insertion point is `"active"`, we're going to create
                // a vertex and start connecting it.
                insertion_point.class_list.remove("active");
                const vertex = create_vertex(this.position_from_offset(new Offset(
                    insertion_point.element.offsetLeft,
                    insertion_point.element.offsetTop,
                )));
                this.select(vertex);
                this.switch_mode(new UIState.Connect(this, vertex, true));
                vertex.element.class_list.add("source");
            } else if (!this.in_mode(UIState.Connect)) {
                // If the cursor leaves the insertion point and we're *not*
                // connecting anything, then hide it.
                insertion_point.class_list.remove("revealed");
            }
        });

        // Moving the insertion point, panning, and rearranging cells.
        this.element.listen("mousemove", (event) => {
            // If the user has currently clicked to place a vertex, then don't reposition the
            // insertion point until the new vertex has been created: otherwise we might move the
            // insertion point before the vertex has been created and accidentally place the vertex
            // in the new position of the insertion point, rather than the old one.
            if (this.in_mode(UIState.Default) && insertion_point.class_list.contains("revealed")) {
                return;
            }

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
                    insertion_point.class_list
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
                    this.element.class_list.remove(this.state.name);
                }
            }
            this.state = state;
            if (this.state.name !== null) {
                this.element.class_list.add(this.state.name);
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
            this.cell_from_offset(this.cell_width, offset.x),
            this.cell_from_offset(this.cell_height, offset.y),
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

    /// A helper method for getting a position from an event.
    position_from_event(event) {
        return this.position_from_offset(this.offset_from_event(event));
    }

    /// A helper method for getting an offset from an event.
    offset_from_event(event) {
        const scale = 2 ** this.scale;
        return new Offset(event.pageX, event.pageY)
            .sub(new Offset(document.body.offsetWidth / 2, document.body.offsetHeight / 2))
            .div(scale)
            .add(this.view);
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
                offset.x += this.cell_size(this.cell_width, col);
            }
            offset.x += this.cell_size(this.cell_width, Math.floor(position.x)) * (position.x % 1);
        }
        if (position.x < 0) {
            for (let col = -1; col >= position.x; --col) {
                offset.x -= this.cell_size(this.cell_width, col);
            }
            offset.x += this.cell_size(this.cell_width, Math.floor(position.x)) * (position.x % 1);
        }

        if (position.y > 0) {
            for (let row = 0; row < Math.floor(position.y); ++row) {
                offset.y += this.cell_size(this.cell_height, row);
            }
            offset.y += this.cell_size(this.cell_height, Math.floor(position.y)) * (position.y % 1);
        }
        if (position.y < 0) {
            for (let row = -1; row >= position.y; --row) {
                offset.y -= this.cell_size(this.cell_height, row);
            }
            offset.y += this.cell_size(this.cell_height, Math.floor(position.y)) * (position.y % 1);
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
        if (!this.buffer_updates) {
            this.update_col_row_size(cell.position);
        }
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
        this.canvas.add(cell.element);
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
    /// If `zoom` is positive, then everything will grow larger.
    pan_view(offset, zoom = 0) {
        this.view.x += offset.x;
        this.view.y += offset.y;
        this.scale += zoom;
        const view = this.view.mul(2 ** this.scale);
        this.canvas.set_style({
            transform: `translate(${-view.x}px, ${-view.y}px) scale(${2 ** this.scale})`,
        });
        this.update_grid();
    }

    /// Centre the view on the quiver.
    centre_view() {
        if (this.quiver.cells.length > 0 && this.quiver.cells[0].size > 0) {
            // We want to centre the view on the diagram, so we take the range of all vertex
            // offsets.
            let min_offset = new Offset(Infinity, Infinity);
            let max_offset = new Offset(-Infinity, -Infinity);
            this.view = Offset.zero();

            for (const vertex of this.quiver.cells[0]) {
                const offset = this.centre_offset_from_position(vertex.position);
                const centre = this.cell_centre_at_position(vertex.position);
                min_offset = min_offset.min(offset.sub(centre));
                max_offset = max_offset.max(offset.add(centre));
            }

            const panel_offset = new Offset(this.panel.element.element.offsetWidth, 0).div(2);
            this.pan_view(min_offset.add(max_offset).div(2).add(panel_offset));
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

    /// Returns the declared macros in a format amenable to passing to KaTeX.
    latex_macros() {
        const macros = {};
        for (const [name, { definition }] of this.macros) {
            // Arities are implicit in KaTeX.
            macros[name] = definition;
        }
        return macros;
    }

    // A helper method for displaying error banners.
    // `type` can be used to selectively dismiss such errors (using the `type` argument on
    // `dismiss_error`).
    static display_error(message, type = null) {
        const body = new DOM.Element(document.body);
        // If there's already an error, it's not unlikely that subsequent errors will be triggered.
        // Thus, we don't display an error banner if one is already displayed.
        if (body.query_selector(".error-banner:not(.hidden)") === null) {
            const error = new DOM.Element("div", { class: "error-banner hidden" })
                .add(message)
                .add(
                    new DOM.Element("button", { class: "close" })
                        .listen("click", () => UI.dismiss_error())
                );
            if (type !== null) {
                error.set_attributes({ "data-type": type });
            }
            body.add(error);
            // Animate the banner's entry.
            UI.delay(() => error.class_list.remove("hidden"));
        }
    }

    /// A helper method for dismissing error banners.
    /// Returns whether there was any banner to dismiss.
    /// If `type` is non-null, `dismiss_error` will only dismiss errors whose type matches.
    static dismiss_error(type = null) {
        const error = new DOM.Element(document.body).query_selector(`.error-banner${
            type !== null ? `[data-type="${type}"]` : ""
        }`);
        if (error) {
            const SECOND = 1000;
            error.class_list.add("hidden");
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

        const scale = 2 ** this.scale;

        const context = canvas.context;
        context.strokeStyle = BORDER_COLOUR;
        context.lineWidth = Math.max(1, CONSTANTS.GRID_BORDER_WIDTH * scale);
        context.setLineDash([DASH_LENGTH * scale]);

        // We want to centre the horizontal and vertical dashes, so we get little crosses in the
        // corner of each grid cell. This is best effort: it is perfect when each column and row
        // is the default size, but otherwise may be imperfect.
        const dash_offset = -DASH_LENGTH * scale / 2;

        const offset = this.view;

        const [[left_col, left_offset], [top_row, top_offset]] = this.col_row_offset_from_offset(
            offset.sub(new Offset(width / scale / 2, height / scale / 2))
        );
        const [[right_col,], [bottom_row,]] = this.col_row_offset_from_offset(
            offset.add(new Offset(width / scale / 2, height / scale / 2))
        );

        // Draw the vertical lines.
        context.beginPath();
        for (let col = left_col, x = left_offset - offset.x;
                col <= right_col; x += this.cell_size(this.cell_width, col++)) {
            context.moveTo(x * scale + width / 2, 0);
            context.lineTo(x * scale + width / 2, height);
        }
        context.lineDashOffset
            = offset.y * scale - dash_offset - height % this.default_cell_size / 2;
        context.stroke();

        // Draw the horizontal lines.
        context.beginPath();
        for (let row = top_row, y = top_offset - offset.y;
                row <= bottom_row; y += this.cell_size(this.cell_height, row++)) {
            context.moveTo(0, y * scale + height / 2);
            context.lineTo(width, y * scale + height / 2);
        }
        context.lineDashOffset
            = offset.x * scale - dash_offset - width % this.default_cell_size / 2;
        context.stroke();
    }

    /// Get an `ArrowStyle` from the `options` associated to an edge.
    /// `ArrowStyle` is used simply for styling: we don't use it as an internal data representation
    /// for quivers. This helps keep a separation between structure and drawing, which makes it
    /// easiser to maintain backwards-compatibility.
    static arrow_style_for_options(arrow, options) {
        // By default, `ArrowStyle` have minimal styling.
        const style = new ArrowStyle();

        // All arrow styles support shifting.
        style.shift = options.offset * CONSTANTS.EDGE_OFFSET_DISTANCE;

        switch (options.style.name) {
            case "arrow":
                style.level = options.level;
                style.curve = options.curve * CONSTANTS.CURVE_HEIGHT * 2;
                // `shorten` is interpreted with respect to the arc length of the arrow.
                const bezier = arrow.bezier();
                try {
                    const [start, end] = arrow.find_endpoints();
                    const arc_length = bezier.arc_length(end.t) - bezier.arc_length(start.t);
                    // We halve `shorten` (`100 - options.length`), because it takes effect at both
                    // ends.
                    style.shorten = arc_length * (100 - options.length) / 200;
                } catch (_) {
                    // If we can't find the endpoints, the arrow isn't being drawn, so we don't
                    // need to bother trying to shorten it.
                }
                // Body style.
                switch (options.style.body.name) {
                    case "squiggly":
                        style.body_style = CONSTANTS.ARROW_BODY_STYLE.SQUIGGLY;
                        break;
                    case "barred":
                        style.body_style = CONSTANTS.ARROW_BODY_STYLE.PROARROW;
                        break;
                    case "dashed":
                        style.dash_style = CONSTANTS.ARROW_DASH_STYLE.DASHED;
                        break;
                    case "dotted":
                        style.dash_style = CONSTANTS.ARROW_DASH_STYLE.DOTTED;
                        break;
                    case "none":
                        style.body_style = CONSTANTS.ARROW_BODY_STYLE.NONE;
                        break;
                }

                // Tail style.
                switch (options.style.tail.name) {
                    case "none":
                        style.tails = CONSTANTS.ARROW_HEAD_STYLE.NONE;
                        break;
                    case "maps to":
                        style.tails = CONSTANTS.ARROW_HEAD_STYLE.MAPS_TO;
                        break;
                    case "mono":
                        style.tails = CONSTANTS.ARROW_HEAD_STYLE.MONO;
                        break;
                    case "hook":
                        style.tails = CONSTANTS.ARROW_HEAD_STYLE[{
                            "top": "HOOK_TOP",
                            "bottom": "HOOK_BOTTOM",
                        }[options.style.tail.side]];
                        break;
                }

                // Head style.
                switch (options.style.head.name) {
                    case "arrowhead":
                        style.heads = CONSTANTS.ARROW_HEAD_STYLE.NORMAL;
                        break;
                    case "none":
                        style.heads = CONSTANTS.ARROW_HEAD_STYLE.NONE;
                        break;
                    case "epi":
                        style.heads = CONSTANTS.ARROW_HEAD_STYLE.EPI;
                        break;
                    case "harpoon":
                        style.heads = CONSTANTS.ARROW_HEAD_STYLE[{
                            "top": "HARPOON_TOP",
                            "bottom": "HARPOON_BOTTOM",
                        }[options.style.head.side]];
                        break;
                }
                break;

            // Adjunction (⊣).
            case "adjunction":
                style.body_style = CONSTANTS.ARROW_BODY_STYLE.ADJUNCTION;
                style.heads = CONSTANTS.ARROW_HEAD_STYLE.NONE;
                break;

            // Pullback/pushout corner.
            case "corner":
                style.body_style = CONSTANTS.ARROW_BODY_STYLE.NONE;
                style.heads = CONSTANTS.ARROW_HEAD_STYLE.NONE;
                style.tails = CONSTANTS.ARROW_HEAD_STYLE.CORNER;
                break;
        }

        return style;
    }

    /// Update the `ArrowStyle` associated to an arrow, as well as label formatting, etc.
    /// This is necessary before redrawing.
    static update_style(arrow, options) {
        // Update the arrow style.
        arrow.style = UI.arrow_style_for_options(arrow, options);
        // Update the label style.
        if (arrow.label !== null) {
            arrow.label.alignment = {
                left: CONSTANTS.LABEL_ALIGNMENT.LEFT,
                right: CONSTANTS.LABEL_ALIGNMENT.RIGHT,
                centre: CONSTANTS.LABEL_ALIGNMENT.CENTRE,
                over: CONSTANTS.LABEL_ALIGNMENT.OVER,
            }[options.label_alignment];
        }
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
            this.panel.render_tex(this, cell);
        }
    }

    /// Load macros from a URL.
    load_macros_from_url(url) {
        // Reset the stored macro URL. We don't want to store outdated URLs, but we also don't
        // want to store invalid URLs, so we'll set `macro_url` when we succeed in fetching the
        // definitions.
        this.macro_url = null;

        const macro_input = this.panel.element.query_selector(".bottom input");
        url = url.trim();
        macro_input.element.value = url;

        const success_indicator = macro_input.parent.query_selector(".success-indicator");
        success_indicator.class_list.remove("success", "failure");
        success_indicator.class_list.add("unknown");

        // Clear the error banner if it's an error caused by a previous failure of
        // `load_macros`.
        UI.dismiss_error("macro-load");

        fetch(url)
            .then((response) => response.text())
            .then((text) => {
                this.load_macros(text);
                this.macro_url = url;
                success_indicator.class_list.remove("unknown");
                success_indicator.class_list.add("success");
                macro_input.element.blur();
            })
            .catch(() => {
                UI.display_error(
                    "Macro definitions could not be loaded " +
                    "from the given URL.",
                    "macro-load",
                );
                success_indicator.class_list.remove("unknown");
                success_indicator.class_list.add("failure");
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
                case "curve":
                    for (const curve of action.curves) {
                        curve.edge.options.curve = curve[to];
                        cells.add(curve.edge);
                    }
                    update_panel = true;
                    break;
                case "length":
                    for (const length of action.lengths) {
                        length.edge.options.length = length[to];
                        cells.add(length.edge);
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
                case "flip":
                    for (const cell of action.cells) {
                        if (cell.is_edge()) {
                            cell.flip(ui);
                        }
                    }
                    update_panel = true;
                    break;
                case "level":
                    for (const level of action.levels) {
                        level.edge.options.level = level[to];
                        cells.add(level.edge);
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
        this.element = new DOM.Element("div", { class: "panel" });

        // Prevent propagation of mouse events when interacting with the panel.
        this.element.listen("mousedown", (event) => {
            event.stopImmediatePropagation();
        });

        // Prevent propagation of scrolling when the cursor is over the panel.
        // This allows the user to scroll the panel when all the elements don't fit on it.
        this.element.listen("wheel", (event) => {
            event.stopImmediatePropagation();
        }, { passive: true });

        // Local options, such as vertex and edge actions.
        const local = new DOM.Element("div", { class: "local" }).add_to(this.element);

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
        this.create_option_list(
            ui,
            local,
            [
                ["left", "Left align label", "left"],
                ["centre", "Centre align label (clear)", "centre"],
                ["over", "Centre align label (over)", "over"],
                ["right", "Right align label", "right"]
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
            (data) => {
                // The length of the arrow.
                const ARROW_LENGTH = 28;
                return {
                    length: ARROW_LENGTH,
                    options: Edge.default_options({ label_alignment: data }),
                    draw_label: true,
                };
            },
        );

        const create_option_slider = (name, property, range) => {
            const slider = new DOM.Element("label").add(`${name}: `).add(
                new DOM.Element(
                    "input",
                    {
                        type: "range",
                        name: property,
                        min: range.min,
                        value: range.value,
                        max: range.max,
                        step: range.step || 1,
                        disabled: true,
                    },
                ).listen("input", (_, slider) => {
                    const value = parseInt(slider.value);
                    const collapse = [property, ui.selection];
                    const actions = ui.history.get_collapsible_actions(collapse);
                    if (actions !== null) {
                        // If the previous history event was to modify the property, then
                        // we're just going to modify that event rather than add a new
                        // one, as with the label input.
                        let unchanged = true;
                        for (const action of actions) {
                            // This ought always to be true.
                            if (action.kind === property) {
                                // Modify the `to` field of each property modification.
                                action[`${property}s`].forEach((modification) => {
                                    modification.to = value;
                                    if (modification.to !== modification.from) {
                                        unchanged = false;
                                    }
                                });
                            }
                        }
                        // Invoke the new property changes immediately.
                        ui.history.effect(ui, actions, false);
                        if (unchanged) {
                            ui.history.pop(ui);
                        }
                    } else {
                        // If this is the start of our property modification,
                        // we need to add a new history event.
                        ui.history.add_collapsible(ui, collapse, [{
                            kind: property,
                            [`${property}s`]: Array.from(ui.selection)
                                .filter(cell => cell.is_edge())
                                .map((edge) => ({
                                    edge,
                                    from: edge.options[property],
                                    to: value,
                                })),
                        }], true);
                    }
                })
            );

            local.add(slider);

            return slider;
        };

        // The offset slider.
        create_option_slider("Offset", "offset", { min: -5, value: 0, max: 5 });

        // The curve slider.
        create_option_slider("Curve", "curve", { min: -5, value: 0, max: 5 })
            .class_list.add("arrow-style");

        // The length slider, which affects `shorten`.
        create_option_slider("Length", "length", { min: 20, value: 100, max: 100, step: 10 })
            .class_list.add("arrow-style", "percentage");

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

        // The button to flip an edge.
        local.add(
            new DOM.Element("button", { title: "Flip arrows", disabled: true })
                .add("⥮ Flip")
                .listen("click", () => {
                    ui.history.add(ui, [{
                        kind: "flip",
                        cells: ui.selection,
                    }], true);
                })
        );

        // The level slider. We limit to 3 for now because there are issues with pixel perfection
        // (especially for squiggly arrows, e.g. with their interaction with hooked tails) after 4,
        // and 3 seems a more consistent setting number with the other settings.. Besides, it's
        // unlikely people will want to draw diagrams involving 4- or 5-cells.
        const level_slider = create_option_slider("Level", "level", { min: 1, value: 1, max: 3 });
        level_slider.class_list.add("arrow-style");

        // The list of tail styles.
        // The length of the arrow to draw in the centre style buttons.
        const ARROW_LENGTH = 72;

        // To make selecting the arrow style button work as expected, we automatically
        // trigger the `"change"` event for the arrow style buttons. This in turn will
        // trigger `record_edge_style_change`, creating many unintentional history
        // actions. To avoid this, we prevent `record_edge_style_change` from taking
        // effect when it's already in progress using the `recording` flag.
        let recording = false;

        // Compute the difference in styling effected by `modify` and record the change in the
        // history.
        const record_edge_style_change = (modify) => {
            if (recording) {
                return;
            }
            recording = true;

            const clone = (x) => JSON.parse(JSON.stringify(x));
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
                    .filter((cell) => cell.is_edge())
                    .map((edge) => ({
                        edge,
                        from: styles.get(edge),
                        to: clone(edge.options.style),
                    })),
            }]);

            recording = false;
        };

        // Trigger an efect that changes an edge style, optionally recording the change in the
        // history.
        const effect_edge_style_change = (record, modify) => {
            if (record) {
                record_edge_style_change(modify);
            } else {
                modify();
            }
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
            (edges, _, data, user_triggered) => {
                effect_edge_style_change(user_triggered, () => {
                    edges.forEach((edge) => edge.options.style.tail = data);
                });
            },
            (data) => ({
                length: 0,
                options: Edge.default_options(null, {
                    tail: data,
                    body: { name: "none" },
                    head: { name: "none" },
                }),
            }),
        );

        // The list of body styles.
        this.create_option_list(
            ui,
            local,
            [
                ["solid", "Solid", { name: "cell", level: 1 }],
                ["dashed", "Dashed", { name: "dashed", level: 1 }],
                ["dotted", "Dotted", { name: "dotted", level: 1 }],
                ["squiggly", "Squiggly", { name: "squiggly", level: 1 }],
                ["barred", "Barred", { name: "barred", level: 1 }],
                ["none", "No body", { name: "none" }],
            ],
            "body-type",
            ["vertical", "arrow-style"],
            true, // `disabled`
            (edges, _, data, user_triggered) => {
                effect_edge_style_change(user_triggered, () => {
                    edges.forEach((edge) => edge.options.style.body = data);
                });
            },
            (data) => ({
                length: ARROW_LENGTH,
                options: Edge.default_options(null, {
                    body: data,
                    head: { name: "none" },
                }),
            }),
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
            (edges, _, data, user_triggered) => {
                effect_edge_style_change(user_triggered, () => {
                    edges.forEach((edge) => edge.options.style.head = data);
                });
            },
            (data) => ({
                length: 0,
                options: Edge.default_options(null, {
                    head: data,
                    body: { name: "none" },
                }),
            }),
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
            (edges, _, data, user_triggered) => {
                effect_edge_style_change(user_triggered, () => {
                    for (const edge of edges) {
                        // We reset `curve`, `level` and `length` for non-arrow edges, because that
                        // data isn't relevant to them. Otherwise, we set them to whatever the
                        // sliders are currently set to. This will preserve them under switching
                        // between arrow styles, because we don't reset the sliders when switching.
                        if (data.name !== "arrow") {
                            edge.options.curve = 0;
                            edge.options.level = 1;
                            edge.options.length = 100;
                        } else if (edge.options.style.name !== "arrow") {
                            edge.options.curve = parseInt(
                                ui.element.query_selector('input[name="curve"]').element.value
                            );
                            edge.options.level = parseInt(
                                ui.element.query_selector('input[name="level"]').element.value
                            );
                            edge.options.length = parseInt(
                                ui.element.query_selector('input[name="length"]').element.value
                            );
                        }
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

                    // Enable/disable the arrow style buttons and curve, length, and level sliders.
                    ui.element.query_selector_all(".arrow-style input")
                        .forEach((input) => input.element.disabled = data.name !== "arrow");

                    // If we've selected the `"arrow"` style, then we need to trigger the
                    // currently-checked buttons and the curve, length, and level sliders so that
                    // we get the expected style, rather than the default style.
                    if (data.name === "arrow") {
                        ui.element.query_selector_all('.arrow-style input[type="radio"]:checked')
                            .forEach((input) => input.element.dispatchEvent(new Event("change")))
                    }
                });
            },
            (data) => ({
                length: ARROW_LENGTH,
                options: Edge.default_options(null, data),
            }),
        );

        const display_export_pane = (format, modify = (output) => output) => {
            // Handle export button interaction: export the quiver.
            // If the user clicks on two different exports in a row
            // we will simply switch the displayed export format.
            // Clicking on the same button twice closes the panel.
            if (this.export !== format) {
                ui.switch_mode(new UIState.Modal());

                // Get the encoding of the diagram. The output may be modified by the caller.
                const { data, metadata } = modify(ui.quiver.export(format));

                let export_pane, warning, list, content;
                if (this.export === null) {
                    // Create the export pane.
                    export_pane = new DOM.Element("div", { class: "export" });
                    warning = new DOM.Element("span", { class: "warning hidden" })
                        .add("The exported tikz-cd diagram may not match the quiver diagram " +
                            "exactly, as tikz-cd does not support the following features that " +
                            "appear in this diagram:")
                        .add(list = new DOM.Element("ul"))
                        .add_to(export_pane);
                    content = new DOM.Element("div", { class: "code" }).add_to(export_pane);
                    ui.element.add(export_pane);
                } else {
                    // Find the existing export pane.
                    export_pane = ui.element.query_selector(".export");
                    warning = export_pane.query_selector(".warning");
                    list = export_pane.query_selector("ul");
                    content = export_pane.query_selector(".code");
                }
                // Display a warning if necessary.
                list.clear();
                const unsupported_items = format === "tikz-cd" ?
                    Array.from(metadata.tikz_incompatibilities).sort() : [];
                for (const [index, item] of unsupported_items.entries()) {
                    list.add(new DOM.Element("li")
                        .add(`${item}${index + 1 < unsupported_items.length ? ";" : "."}`)
                    );
                }
                warning.class_list.toggle("hidden", unsupported_items.length === 0);

                // At present, the data is always a string.
                content.clear().add(data);

                this.export = format;

                // Select the code for easy copying.
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(content.element);
                selection.removeAllRanges();
                selection.addRange(range);
                // Disable cell data editing while the export pane is visible.
                this.update(ui);
            } else {
                this.dismiss_export_pane(ui);
            }
        };

        this.element.add(
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
                                return {
                                    data: `${output.data}&macro_url=${
                                        encodeURIComponent(ui.macro_url)
                                    }`,
                                    metadata: output.metadata,
                                };
                            }
                            return output;
                        });
                    })
            ).add(
                // The export button.
                new DOM.Element("button", { class: "global" }).add("Export to LaTeX")
                    .listen("click", () => display_export_pane("tikz-cd"))
            )
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
    ) {
        const options_list = new DOM.Element("div", { class: `options` });
        options_list.class_list.add(...classes);

        const create_option = (value, tooltip, data) => {
            const button = new DOM.Element("input", {
                type: "radio",
                name,
                value,
                title: tooltip,
            }).listen("change", (event, button) => {
                if (button.checked) {
                    const selected_edges = Array.from(ui.selection).filter(cell => cell.is_edge());
                    on_check(selected_edges, value, data, event.isTrusted);
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

            const { length, options, draw_label } = properties(data);

            const arrow = new Arrow(
                new Shape.Endpoint(Point.zero()),
                new Shape.Endpoint(new Point(length, 0)),
            );

            // The size of the label.
            const LABEL_SIZE = 12;
            // How much smaller the placeholder box in the label position should be.
            const LABEL_MARGIN = 2;
            if (draw_label) {
                arrow.label = new Label();
                arrow.label.size = new Dimensions(LABEL_SIZE, LABEL_SIZE);
            }

            UI.update_style(arrow, options);
            const svg = arrow.svg;
            svg.set_attributes({ xmlns: DOM.SVGElement.NAMESPACE });

            for (const colour of ["black", "grey"]) {
                arrow.style.colour = colour;
                arrow.redraw();
                // The `style` transforms the position of the arrow, which we don't want here,
                // where we're trying to automatically position the arrows in the centre of the
                // buttons.
                svg.remove_attributes("style");
                if (draw_label) {
                    arrow.label.element.set_style({
                        width: `${LABEL_SIZE - LABEL_MARGIN * 2}px`,
                        height: `${LABEL_SIZE - LABEL_MARGIN * 2}px`,
                        margin: `${LABEL_MARGIN}px`,
                        background: colour,
                    });
                }
                backgrounds.push(`url('data:image/svg+xml;utf8,${
                    encodeURIComponent(svg.element.outerHTML)}')`);
            }
            button.set_style({ "background-image": backgrounds.join(", ") });

            return button;
        };

        for (const [value, tooltip, data, classes = []] of entries) {
            create_option(value, tooltip, data).class_list.add(...classes);
        }

        options_list.query_selector(`input[name="${name}"]`).element.checked = true;

        local.add(options_list);
    }

    /// Render the TeX contained in the label of a cell.
    render_tex(ui, cell) {
        const label = cell.element.query_selector(".label");

        const update_label_transformation = () => {
            if (cell.is_edge()) {
                // Resize the bounding box for the label.
                // In Firefox, the bounding rectangle for the KaTeX element seems to be sporadically
                // available, unless we render the arrow *beforehand*.
                cell.render(ui);
                const bounding_rect = label.query_selector(".katex, .katex-error").bounding_rect();
                cell.arrow.label.size = new Dimensions(
                    bounding_rect.width
                        + (bounding_rect.width > 0 ? CONSTANTS.EDGE_LABEL_PADDING * 2 : 0),
                    bounding_rect.height
                        + (bounding_rect.height > 0 ? CONSTANTS.EDGE_LABEL_PADDING * 2 : 0),
                );
                // Rerender the edge with the new label.
                cell.render(ui);
            } else {
                cell.resize_content(ui, ui.resize_label(cell, label.element));
            }
        };

        // Render the label with KaTeX.
        // Currently all errors are disabled, so we don't wrap this in a try-catch block.
        KaTeX.then((katex) => {
            katex.render(
                cell.label.replace(/\$/g, "\\$"),
                label.element,
                {
                    throwOnError: false,
                    errorColor: "hsl(0, 100%, 40%)",
                    macros: ui.latex_macros(),
                },
            );
            update_label_transformation();
        });
    };

    /// Update the panel state (i.e. enable/disable fields as relevant).
    update(ui) {
        const input = this.element.query_selector('label input[type="text"]');
        const label_alignments = this.element.query_selector_all('input[name="label-alignment"]');
        const sliders = this.element.query_selector_all('input[type="range"]');

        // Modifying cells is not permitted when the export pane is visible.
        if (this.export === null) {
            // Default options (for when no cells are selected). We only need to provide defaults
            // for inputs that display their state even when disabled.
            if (ui.selection.size === 0) {
                input.element.value = "";
                sliders.forEach((slider) => {
                    return slider.element.value = slider.element.name !== "length" ? 0 : 100;
                });
            }

            // Multiple selection is always permitted, so the following code must provide sensible
            // behaviour for both single and multiple selections (including empty selections).
            const selection_includes_edge = Array.from(ui.selection).some((cell) => cell.is_edge());

            // Enable all the inputs iff we've selected at least one edge.
            this.element.query_selector_all('input:not([type="text"]), button:not(.global)')
                .forEach((input) => input.element.disabled = !selection_includes_edge);

            // Enable the label input if at least one cell has been selected.
            input.element.disabled = ui.selection.size === 0;
            if (input.element.disabled && document.activeElement === input.element) {
                // In Firefox, if the active element is disabled, then key
                // presses aren't registered, so we need to blur it manually.
                input.element.blur();
            }

            // Label alignment options are always enabled.
            for (const option of label_alignments) {
                option.element.disabled = false;
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
                    consider("{angle}", cell.angle());
                    consider("{offset}", cell.options.offset);
                    consider("{curve}", cell.options.curve);
                    consider("{length}", cell.options.length);
                    consider("{level}", cell.options.level);
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
                                    value = "solid";
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
                        input.element.value = value !== null ? value : "";
                        break;
                    case "{angle}":
                        const angle = value !== null ? value : 0;
                        for (const option of label_alignments) {
                            option.set_style({
                                transform: `rotate(${Math.round(2 * angle / Math.PI) * 90}deg)`
                            });
                        }
                        break;
                    case "{offset}":
                    case "{curve}":
                    case "{length}":
                    case "{level}":
                        const property = name.slice(1, -1);
                        const slider = this.element.query_selector(`input[name="${property}"]`);
                        slider.element.value = value !== null ? value : 0;
                        break;
                    default:
                        if (value === null) {
                            // Uncheck any checked input for which there are
                            // multiple selected values.
                            this.element.query_selector_all(
                                `input[name="${name}"]:checked`
                            ).forEach((input) => input.element.checked = false);
                        } else {
                            // Check any input for which there is a canonical choice of value.
                            this.element.query_selector(
                                `input[name="${name}"][value="${value}"]`
                            ).element.checked = true;
                        }
                        break;
                }
            }

            // Update the actual `value` attribute for the offset, curve, length, and level sliders
            // so that we can reference it in the CSS.
            sliders.forEach((slider) => slider.set_attributes({ "value": slider.element.value }));

            // Disable/enable the arrow style buttons and the curve, length, and level sliders.
            for (const option of this.element.query_selector_all(".arrow-style input")) {
                option.element.disabled = !all_edges_are_arrows;
            }

            // Enable all inputs in the bottom section of the panel.
            this.element.query_selector_all(`.bottom input[type="text"]`).forEach((input) => {
                input.element.disabled = false;
            });
        } else {
            // Disable all the inputs.
            this.element.query_selector_all("input:not(.global), button:not(.global)")
                .forEach((input) => input.element.disabled = true);
        }
    }

    /// Dismiss the export pane, if it is shown.
    dismiss_export_pane(ui) {
        if (this.export !== null) {
            ui.element.query_selector(".export").remove();
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
            .listen("mousedown", (event) => event.stopImmediatePropagation());

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

            const trigger_action_and_update_toolbar = (event) => {
                action(event);
                ui.toolbar.update(ui);
            };

            const button = new DOM.Element("button", { class: "action", "data-name": name })
                .add(new DOM.Element("span", { class: "symbol" }).add(symbol))
                .add(new DOM.Element("span", { class: "name" }).add(name))
                .add(new DOM.Element("span", { class: "shortcut" }).add(shortcut_name))
                .listen("mousedown", (event) => event.stopImmediatePropagation())
                .listen("click", trigger_action_and_update_toolbar);

            if (disabled) {
                button.element.disabled = true;
            }

            add_shortcut(combinations, trigger_action_and_update_toolbar, button);

            this.element.add(button);
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
        redo.query_selector(".symbol").class_list.add("flip");

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

        add_action(
            "-",
            "Zoom out",
            [{ key: "-", modifier: true, context: SHORTCUT_PRIORITY.Always }],
            () => {
                ui.pan_view(Offset.zero(), -0.25);
            },
            false,
        );

        add_action(
            "+",
            "Zoom in",
            [{ key: "=", modifier: true, context: SHORTCUT_PRIORITY.Always }],
            () => {
                ui.pan_view(Offset.zero(), 0.25);
            },
            false,
        );

        add_action(
            "=",
            "Reset zoom",
            [],
            () => {
                ui.scale = 0;
                ui.pan_view(Offset.zero());
            },
            true,
        );

        add_action(
            "⌗",
            "Toggle grid",
            [{ key: "h", modifier: false, context: SHORTCUT_PRIORITY.Defer }],
            () => {
                ui.grid.class_list.toggle("hidden");
            },
            false,
        );

        // Add the other, "invisible", shortcuts.

        add_shortcut([{ key: "Enter" }], () => {
            // Focus the label input.
            const input = ui.panel.element.query_selector('label input[type="text"]').element;
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
            }
            // If we're waiting to start connecting a cell, then we stop waiting.
            const pending = ui.element.query_selector(".cell.pending");
            if (pending !== null) {
                pending.class_list.remove("pending");
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

        // Handle global key presses (such as, but not exclusively limited to, keyboard shortcuts).
        const handle_shortcut = (type, event) => {
            // Many keyboard shortcuts are only relevant when we're not midway
            // through typing in an input, which should capture key presses.
            const editing_input = ui.input_is_active();

            // Trigger a "flash" animation on an element.
            const flash = (button) => {
                button.class_list.remove("flash");
                // Removing a class and instantly adding it again is going to be ignored by
                // the browser, so we need to trigger a reflow to get the animation to
                // retrigger.
                void button.element.offsetWidth;
                button.class_list.add("flash");
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
                                if (shortcut.button === null || !shortcut.button.element.disabled) {
                                    // Only trigger the action if the associated button is not
                                    // disabled.
                                    action(event);
                                }
                                if (shortcut.button !== null) {
                                    // The button might be disabled by `action`, but we still want
                                    // to trigger the visual indication if it was enabled when
                                    // activated.
                                    if (!shortcut.button.element.disabled) {
                                        // Give some visual indication that the action has
                                        // been triggered.
                                        flash(shortcut.button);
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
                                        flash(new DOM.Element(input));
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
            const element = this.element.query_selector(`.action[data-name="${name}"]`).element;
            element.disabled = !condition;
        };

        enable_if("Undo", ui.history.present !== 0);
        enable_if("Redo", ui.history.present < ui.history.actions.length);
        enable_if("Select all", ui.selection.size < ui.quiver.all_cells().length);
        enable_if("Deselect all", ui.selection.size > 0);
        enable_if("Delete", ui.selection.size > 0);
        enable_if("Centre view", ui.quiver.cells.length > 0 && ui.quiver.cells[0].size > 0);
        enable_if("Zoom in", ui.scale < 1);
        enable_if("Zoom out", ui.scale > -2.5);
        enable_if("Reset zoom", ui.scale !== 0);
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
        this.element.class_list.add("cell");

        const content_element = this.content_element;

        /// For cells with a separate `content_element`, we allow the cell to be moved
        /// by dragging its `element` (under the assumption it doesn't totally overlap
        /// its `content_element`). For now, these are precisely the vertices.
        // We allow vertices to be moved by dragging its `element` (which contains its
        // `content_element`, the element with the actual cell content).
        if (this.is_vertex()) {
            this.element.listen("mousedown", (event) => {
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

        content_element.listen("mousedown", (event) => {
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
                    this.element.class_list.add("pending");
                }
            }
        });

        content_element.listen("mouseenter", () => {
            if (ui.in_mode(UIState.Connect)) {
                // The second part of the condition should not be necessary, because pointer events
                // are disabled for reconnected edges, but this acts as a warranty in case this is
                // not working.
                if (ui.state.source !== this
                    && (ui.state.reconnect === null || ui.state.reconnect.edge !== this)) {
                    if (ui.state.valid_connection(ui, this)) {
                        ui.state.target = this;
                        this.element.class_list.add("target");
                        // Hide the insertion point (e.g. if we're connecting a vertex to an edge).
                        const insertion_point = ui.canvas.query_selector(".insertion-point");
                        insertion_point.class_list.remove("revealed", "pending", "active");
                    }
                }
            }
        });

        content_element.listen("mouseleave", () => {
            if (this.element.class_list.contains("pending")) {
                this.element.class_list.remove("pending");

                // Start connecting the node.
                const state = new UIState.Connect(ui, this, false);
                if (state.valid_connection(ui, null)) {
                    ui.switch_mode(state);
                    this.element.class_list.add("source");
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
                this.element.class_list.remove("target");
            }
        });

        content_element.listen("mouseup", (event) => {
            if (event.button === 0) {
                // If we release the pointer without ever dragging, then
                // we never begin connecting the cell.
                this.element.class_list.remove("pending");

                if (ui.in_mode(UIState.Default)) {
                    // Focus the label input for a cell if we've just ended releasing
                    // the mouse on top of the source.
                    if (was_previously_selected) {
                        ui.panel.element.query_selector('label input[type="text"]').element.focus();
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

    select() {
        this.element.class_list.add("selected");
    }

    deselect() {
        this.element.class_list.remove("selected");
    }

    size() {
        if (this.is_vertex()) {
            const label = this.element.query_selector(".label");
            return new Dimensions(label.element.offsetWidth, label.element.offsetHeight);
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
        // The shape data is going to be overwritten immediately, so really this information is
        // unimportant.
        this.shape = new Shape.RoundedRect(
            Point.zero(),
            new Dimensions(ui.default_cell_size / 2, ui.default_cell_size / 2),
            ui.default_cell_size / 8,
        );

        this.render(ui);
        super.initialise(ui);
    }

    get content_element() {
        if (this.element !== null) {
            return this.element.query_selector(".content");
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
        this.shape.origin = ui.centre_offset_from_position(this.position);
    }

    /// Create the HTML element associated with the vertex.
    render(ui) {
        const construct = this.element === null;

        // The container for the cell.
        if (construct) {
            this.element = new DOM.Element("div");
        }

        // Position the vertex.
        const offset = ui.offset_from_position(this.position);
        this.element.set_style({
            left: `${offset.x}px`,
            top: `${offset.y}px`,
        });
        const centre_offset = offset.add(ui.cell_centre_at_position(this.position));
        this.shape.origin = centre_offset;
        // Shape width is controlled elsewhere.

        // Resize according to the grid cell.
        const cell_width = ui.cell_size(ui.cell_width, this.position.x);
        const cell_height = ui.cell_size(ui.cell_height, this.position.y);
        this.element.set_style({
            width: `${cell_width}px`,
            height: `${cell_height}px`,
        });

        if (construct) {
            this.element.class_list.add("vertex");

            // The cell content (containing the label).
            new DOM.Element("div", { class: "content" })
                .add(new DOM.Element("div", { class: "label" }))
                .add_to(this.element);
        }

        // Resize the content according to the grid cell. This is just the default size: it will be
        // updated by `render_tex`.
        this.content_element.set_style({
            width: `${ui.default_cell_size / 2}px`,
            height: `${ui.default_cell_size / 2}px`,
            left: `${cell_width / 2}px`,
            top: `${cell_height / 2}px`,
        });

        // Ensure we re-render the label when the cell is moved, in case the cell that that label is
        // moved into is a different size.
        ui.panel.render_tex(ui, this);
    }

    /// Get the size of the cell content.
    content_size(ui, sizes) {
        const [width, height] = sizes;
        return new Dimensions(
            Math.max(ui.default_cell_size / 2, width + CONSTANTS.CONTENT_PADDING * 2),
            Math.max(ui.default_cell_size / 2, height + CONSTANTS.CONTENT_PADDING * 2),
        );
    }

    /// Resize the cell content to match the label width.
    resize_content(ui, sizes) {
        const size = this.content_size(ui, sizes);
        this.content_element.set_style({
            width: `${size.width}px`,
            height: `${size.height}px`,
        });
        this.shape.size = size;
    }
}

/// k-cells (for k > 0), or edges. This is primarily specialised in its set up of HTML elements.
class Edge extends Cell {
    constructor(ui, label = "", source, target, options) {
        super(ui.quiver, Math.max(source.level, target.level) + 1, label);

        this.options = Edge.default_options(Object.assign({ level: this.level }, options));

        this.arrow = new Arrow(source.shape, target.shape, new ArrowStyle(), new Label());
        this.element = this.arrow.element;

        // `this.shape` is used for the source/target from (higher) cells connected to this one.
        // This is located at the centre of the arrow.
        this.shape = new Shape.Endpoint(Point.zero());

        this.reconnect(ui, source, target);

        this.initialise(ui);
    }

    /// A set of defaults for edge options: a basic arrow (→).
    static default_options(override_properties = null, override_style = null) {
        let options = Object.assign({
            label_alignment: "left",
            offset: 0,
            curve: 0,
            length: 100,
            level: 1,
            style: Object.assign({
                name: "arrow",
                tail: { name: "none" },
                body: { name: "cell" },
                head: { name: "arrowhead" },
            }, override_style),
        }, override_properties);

        return options;
    }

    initialise(ui) {
        super.initialise(ui);

        // We allow users to reconnect edges to different cells by dragging their endpoint handles.
        const reconnect = (event, end) => {
            event.stopPropagation();
            event.preventDefault();
            // We don't get the default blur behaviour here, as we've prevented it, so we have to do
            // it ourselves.
            ui.panel.element.query_selector('label input[type="text"]').element.blur();

            const fixed = { source: this.target, target: this.source }[end];
            ui.switch_mode(new UIState.Connect(ui, fixed, false, {
                end,
                edge: this,
            }));
        };

        // Set up the endpoint handle interaction events.
        for (const end of ["source", "target"]) {
            const handle = this.arrow.element.query_selector(`.arrow-endpoint.${end}`);
            handle.listen("mousedown", (event) => reconnect(event, end));
        }

        ui.panel.render_tex(ui, this);
    }

    /// Create the HTML element associated with the edge.
    /// Note that `render_tex` triggers redrawing the edge, rather than the other way around.
    render(ui, pointer_offset = null) {
        // If we're reconnecting an edge, then we vary its source/target (depending on
        // which is being dragged) depending on the pointer position.
        if (pointer_offset !== null) {
            if (ui.state.target !== null) {
                // In this case, we're hovering over another cell.
                this.arrow[ui.state.reconnect.end] = ui.state.target.shape;
            } else {
                // In this case, we're not hovering over another cell.
                // Usually we offset edge endpoints from the cells to which they are connected,
                // but when we are dragging an endpoint, we want to draw it right up to the pointer.
                this.arrow[ui.state.reconnect.end] = new Shape.Endpoint(pointer_offset);
            }
        }

        UI.update_style(this.arrow, this.options);
        this.arrow.redraw();

        // Update the origin, which is given by the centre of the edge.
        const bezier = this.arrow.bezier();
        let centre = null;
        try {
            // Preferably, we take the centre relative to the endpoints, rather than the
            // source and target.
            const [start, end] = arrow.find_endpoints();
            centre = bezier.point((start.t + end.t) / 2);
        } catch (_) {
            // If we can't find the endpoints, we just take the centre relative to the
            // source and target.
            centre = bezier.point(0.5);
        }
        this.shape.origin = this.arrow.source.origin.add(
            centre.add(new Point(0, this.arrow.style.shift)).rotate(this.arrow.angle()),
        );

        // We override the source and target whilst drawing, so we need to reset them.
        this.arrow.source = this.source.shape;
        this.arrow.target = this.target.shape;
    }

    /// Returns the angle of this edge.
    angle() {
        return this.target.shape.origin.sub(this.source.shape.origin).angle();
    }

    /// Changes the source and target.
    reconnect(ui, source, target) {
        [this.arrow.source, this.arrow.target] = [source.shape, target.shape];
        ui.quiver.connect(source, target, this);
        for (const cell of ui.quiver.transitive_dependencies([this])) {
            cell.render(ui);
        }
    }

    /// Flips the edge, including label alignment, offset and head/tail style.
    flip(ui, skip_dependencies = false) {
        this.options.label_alignment = {
            left: "right",
            centre: "centre",
            over: "over",
            right: "left",
        }[this.options.label_alignment];
        this.options.offset = -this.options.offset;
        this.options.curve = -this.options.curve;
        if (this.options.style.name === "arrow") {
            const swap_sides = { top: "bottom", bottom: "top" };
            if (this.options.style.tail.name === "hook") {
                this.options.style.tail.side = swap_sides[this.options.style.tail.side];
            }
            if (this.options.style.head.name === "harpoon") {
                this.options.style.head.side = swap_sides[this.options.style.head.side];
            }
        }

        this.render(ui);

        if (!skip_dependencies) {
            for (const cell of ui.quiver.transitive_dependencies([this])) {
                cell.render(ui);
            }
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

        // Swap the `source` and `target`.
        [this.source, this.target] = [this.target, this.source];
        [this.arrow.source, this.arrow.target] = [this.source.shape, this.target.shape];

        // Reverse the label alignment and edge offset as well as any oriented styles.
        // Flipping the label will also cause a rerender.
        // Note that since we do this, the position of the edge will remain the same, which means
        // we don't need to rerender any of this edge's dependencies.
        this.flip(ui, true);
    }
}

// A `Promise` that returns the `katex` global object when it's loaded.
let KaTeX = null;

// We want until the (minimal) DOM content has loaded, so we have access to `document.body`.
document.addEventListener("DOMContentLoaded", () => {
    // We don't want the browser being too clever and trying to restore the scroll position, as that
    // won't play nicely with the auto-centring.
    if ("scrollRestoration" in window.history) {
        window.history.scrollRestoration = "manual";
    }

    // The global UI.
    const ui = new UI(new DOM.Element(document.body));
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

    // Immediately load the KaTeX library.
   const rendering_library = new DOM.Element("script", {
        type: "text/javascript",
        src: "KaTeX/dist/katex.js",
    }).listen("error", () => {
        // Handle KaTeX not loading (somewhat) gracefully.
        UI.display_error(`KaTeX failed to load.`)
    });

    KaTeX = new Promise((accept) => {
        rendering_library.listen("load", () => {
            accept(katex);
            // KaTeX is fast enough to be worth waiting for, but not
            // immediately available. In this case, we delay loading
            // the quiver until the library has loaded.
            load_quiver_from_query_string();
        })
    });

    // Load the style sheet needed for KaTeX.
    document.head.appendChild(new DOM.Element("link", {
        rel: "stylesheet",
        href: "KaTeX/dist/katex.css",
    }).element);
    // Preload various fonts to avoid flashes of unformatted text.
    const preload_fonts = ["Main-Regular", "Math-Italic"];
    for (const font of preload_fonts) {
        const attributes = {
            rel: "preload",
            href: `KaTeX/dist/fonts/KaTeX_${font}.woff2`,
            as: "font"
        };
        if (window.location.hostname !== "") {
            // Fonts always need to be fetched using `crossorigin`.
            attributes.crossorigin = "";
        }
        document.head.appendChild(new DOM.Element("link", attributes).element);
    }

    // Trigger the script load.
    document.head.appendChild(rendering_library.element);
});
