"use strict";

/// Various parameters.
Object.assign(CONSTANTS, {
    /// The current quiver version.
    VERSION: "1.5.2",
    /// When the `quiver.sty` package was last modified.
    PACKAGE_VERSION: "2021/01/11",
    /// We currently only support n-cells for (n ≤ 4). This restriction is not technical: it can be
    /// lifted in the editor without issue. Rather, this is for usability: a user is unlikely to
    /// want to draw a higher cell. For n-cells for n ≥ 3, we make use of tikz-nfold in exported
    /// diagrams.
    MAXIMUM_CELL_LEVEL: 4,
    /// The width of the dashed grid lines.
    GRID_BORDER_WIDTH: 2,
    /// The padding of the content area of a vertex.
    CONTENT_PADDING: 8,
    /// How much (horizontal and vertical) space (in pixels) in the SVG to give around the arrow
    /// (to account for artefacts around the drawing).
    SVG_PADDING: 6,
    /// How much space (in pixels) to leave between adjacent parallel arrows.
    EDGE_OFFSET_DISTANCE: 8,
    /// How many pixels each unit of curve height corresponds to.
    CURVE_HEIGHT: 24,
    /// How many pixels each unit of loop radius corresponds to.
    LOOP_HEIGHT: 16,
    /// How many pixels of padding to place around labels on edges.
    EDGE_LABEL_PADDING: 8,
    /// How much padding to try to keep around the focus point when moving it via the keyboard
    /// (in pixels).
    VIEW_PADDING: 128,
    /// How long the user has to hold down on a touchscreen to trigger panning.
    LONG_PRESS_DURATION: 800,
    /// How much to shorten edges connected to edges by (in %), by default.
    EDGE_EDGE_PADDING: 20,
    /// Default dimensions (in pixels) of an HTML embedded diagram, which may be overridden by the
    /// user.
    DEFAULT_EMBED_SIZE: {
        WIDTH: 400,
        HEIGHT: 400,
    },
    /// How many pixels to leave around the border of an embedded diagram.
    EMBED_PADDING: 24,
    /// Minimum and maximum zoom levels.
    MIN_ZOOM: -2.5,
    MAX_ZOOM: 1,
});

/// Various states for the UI (e.g. whether cells are being rearranged, or connected, etc.).
class UIMode {
    constructor() {
        // Used for the CSS class associated with the mode. `null` means no class.
        this.name = null;
    }

    /// A placeholder method to clean up any state when a mode is left.
    release() {}
}

/// The default mode, representing no special action.
UIMode.Default = class extends UIMode {
    constructor() {
        super();

        this.name = "default";
    }
};
UIMode.default = new UIMode.Default();

UIMode.Modal = class extends UIMode {
    constructor() {
        super();

        this.name = "modal";
    }
}

/// Two k-cells are being connected by an (k + 1)-cell.
UIMode.Connect = class extends UIMode {
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

        // Whether we have dragged far enough from the source to trigger the loop mode.
        this.loop = false;

        if (this.reconnect === null) {
            // The overlay for drawing an edge between the source and the cursor.
            this.overlay = new DOM.Div({ class: "overlay" });
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
        // If we're connecting from an focus point, then we need to hide it again.
        ui.focus_point.class_list.remove("revealed");
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
        this.loop = false;
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
            const distance = this.arrow.target.origin.sub(this.arrow.source.origin).length();
            // We only permit loops on vertices, not edges.
            if (level === 1 && distance >= CONSTANTS.ARC.OUTER_DIS) {
                this.loop = true;
            }

            this.arrow.style = UI.arrow_style_for_options(
                this.arrow,
                Edge.default_options({
                    level,
                    shorten: {
                        source: this.source.level === 0 ? 0 : CONSTANTS.EDGE_EDGE_PADDING,
                        target: target.level === 0 ? 0 : CONSTANTS.EDGE_EDGE_PADDING,
                    },
                    shape: this.loop ? "arc" : "bezier",
                    angle: this.loop ? UIMode.Connect.suggested_loop_angle(ui, this.source) : 0,
                }),
            );

            this.arrow.redraw();
        } else {
            // We're reconnecting an existing edge.

            // Note that we currently do not permit existing edges to be converted into loops,
            // simply because the desired behaviour is subtle (e.g. we don't want edges with
            // dependencies to be converted, and we'd have to interpolate curves into loops, etc.).
            // Thus, the only time `this.loop` will be true is if we're reconnecting an existing
            // loop. We can convert loops into non-loops.
            this.loop = this.reconnect.edge.is_loop();

            this.reconnect.edge.render(ui, offset);
            for (const cell of ui.quiver.transitive_dependencies([this.reconnect.edge], true)) {
                cell.render(ui);
            }
        }
    }

    /// Returns whether the `source` is compatible with the specified `target`.
    /// This first checks that the source is valid at all.
    static valid_connection(ui, source, target, reconnect = null) {
        // To allow `valid_connection` to be used to simply check whether the source is valid,
        // we ignore source--target compatibility if `target` is null.
        // We allow cells to be connected even if they do not have the same level. This is
        // because it's often useful when drawing diagrams, even if it may not always be
        // semantically valid.

        if (source === target) {
            // We currently only permit loops on nodes.
            return source.level === 0;
        }
        if (source.is_loop() || (target !== null && target.is_loop())) {
            // We do not permit loops to be connected to anything else.
            return false;
        }
        const source_target_level = Math.max(source.level, target === null ? 0 : target.level);
        if (source_target_level + 1 > CONSTANTS.MAXIMUM_CELL_LEVEL) {
            return false;
        }

        if (reconnect === null) {
            // If there are no edges depending on this one, then there are no other obstructions to
            // being connectable.
            return true;
        } else {
            if (target === reconnect.edge) {
                // We obviously can't connect an edge to itself.
                return false;
            }

            // We need to check that the dependencies also don't have too great a level after
            // reconnecting.
            // We're going to temporarily increase the level of the edge to what it would be,
            // and check for any edges that then exceed the `MAXIMUM_CELL_LEVEL`. This is
            // conceptually the simplest version of the check.
            const edge_level = reconnect.edge.level;
            reconnect.edge.level = source_target_level + 1;

            let exceeded_max_level = false;

            const update_levels = () => {
                for (const cell of ui.quiver.transitive_dependencies([reconnect.edge], true)) {
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
            reconnect.edge.level = edge_level;
            // Reset the levels of its dependencies.
            update_levels();

            return !exceeded_max_level;
        }
    }

    /// Creates a new edge.
    static create_edge(ui, source, target) {
        // We attempt to guess what the intended label alignment is and what the intended edge
        // offset is, if the cells being connected form some path with existing connections.
        // Otherwise we revert to the currently-selected label alignment in the panel and the
        // default offset (0).
        const options = {
            // By default, 2-cells and above have a little padding for aesthetic purposes.
            shorten: {
                source: source.level === 0 ? 0 : CONSTANTS.EDGE_EDGE_PADDING,
                target: target.level === 0 ? 0 : CONSTANTS.EDGE_EDGE_PADDING,
            },
            // We will guess the label alignment below, but in case there's no selected label
            // alignment, we default to "left".
            label_alignment: "left",
            // The default settings for the other options are fine.
        };
        const selected_alignment
            = ui.panel.element.query_selector('input[name="label_alignment"]:checked');
        if (selected_alignment !== null) {
            // If multiple edges are selected and not all selected edges have the same label
            // alignment, there will be no checked input.
            options.label_alignment = selected_alignment.element.value;
        }

        // The following heuristics are really only sensible for non-loops.
        if (source !== target) {
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

            const flip = (options) => {
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

            const conserve = (options, parallel) => {
                return {
                    label_alignment: options.label_alignment,
                    // We ignore the offsets and curves of edges that don't share a source and
                    // target with the new edge, i.e. we only modify the offset and curve of
                    // parallel edges.
                    offset: parallel ? options.offset : null,
                    curve: parallel ? options.curve : null,
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

            const source_dependencies = ui.quiver.dependencies_of(source);
            const target_dependencies = ui.quiver.dependencies_of(target);
            for (const [edge, relationship] of source_dependencies) {
                // We consider each edge whose source or target is the source of the new edge.
                consider(conserve({
                    // If the source of the edge is the same as the source of the new edge, we want
                    // to invert the offset/curve/etc., so that the new edge will not overlap the
                    // new one.
                    source: flip(edge.options),
                    target: edge.options,
                }[relationship], target_dependencies.has(edge)), -1);
            }
            for (const [edge, relationship] of target_dependencies) {
                // We consider each edge whose source or target is the target of the new edge.
                consider(conserve({
                    source: edge.options,
                    // If the target of the edge is the same as the target of the new edge, we want
                    // to invert the offset/curve/etc., so that the new edge will not overlap the
                    // new one.
                    target: flip(edge.options),
                }[relationship], source_dependencies.has(edge)), 1);
            }

            if (align.size === 1) {
                options.label_alignment = align.keys().next().value;
            } else if (align.size > 0
                    && align.get("left") === align.get("right") && balance === 0) {
                options.label_alignment = "centre";
            }

            if (offset.size === 1) {
                options.offset = offset.keys().next().value;
            }
            if (curve.size === 1) {
                options.curve = curve.keys().next().value;
            }
        } else {
            // We try to place new loops at a new angle, if possible.
            options.angle = UIMode.Connect.suggested_loop_angle(ui, source);
        }

        const label = "";
        // The edge itself does all the set up, such as adding itself to the page.
        return new Edge(ui, label, source, target, options);
    }

    /// Returns an appropriate angle at which to create a new loop, reducing overlap with existing
    /// loops where possible.
    static suggested_loop_angle(ui, vertex) {
        const angles = new Map();
        for (const [loop,] of Array.from(ui.quiver.dependencies_of(vertex))
            .filter(([edge,]) => edge.is_loop()))
        {
            const angle
                = mod(loop.options.angle + 180 - (loop.options.radius < -1 ? 180 : 0), 360) - 180;
            angles.set(angle, Math.abs(loop.options.radius));
            // Both -180 and 180 are possible angle values for symmetry, but they should count
            // as the same angle.
            if (Math.abs(angle) === 180) {
                angles.set(-angle, Math.abs(loop.options.radius));
            }
        }
        // First, attempt to find an angle at which there exists no loop.
        for (let angle = 0; angle < 360; angle += 45) {
            const attempt_angle = mod(180 - angle, 360) - 180;
            if (!angles.has(attempt_angle)) {
                return attempt_angle;
            }
        }
        // Next, attempt to find an angle at which there is no loop of the default radius.
        for (let angle = 0; angle < 360; angle += 45) {
            const attempt_angle = mod(180 - angle, 360) - 180;
            if (angles.get(attempt_angle) !== 3) {
                return attempt_angle;
            }
        }
        // Otherwise, default to 0.
        return 0;
    }

    /// Connects the source and target. Note that this does *not* check whether the source and
    /// target are compatible with each other.
    connect(ui, event) {
        if (this.reconnect === null) {
            if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                ui.deselect();
            }
            const edge = UIMode.Connect.create_edge(ui, this.source, this.target);
            ui.select(edge);
            if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                if (event.isTrusted) {
                    // Don't focus the input on touchscreens, since this can be
                    // offputting, as it often brings up a virtual keyboard.
                    ui.panel.label_input.element.focus();
                }
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
            // one can always assume that `mode.target` is the possibly-null, moving endpoint
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

/// Cells are being moved to a different position, via the pointer.
UIMode.PointerMove = class extends UIMode {
    constructor(ui, origin, selection) {
        super();

        this.name = "pointer-move";

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

/// Cells are being moved to a different position, via the keyboard.
UIMode.KeyMove = class extends UIMode {
    constructor(ui) {
        super();

        this.name = "key-move";

        this.tooltip = new DOM.Div({ class: "tooltip" })
                .add("Move the selected objects with the arrow keys.")
                .add(new DOM.Element("br"))
                .add("Press ")
                .add(new DOM.Element("kbd").add("B"))
                .add(" or ")
                .add(new DOM.Element("kbd").add("esc"))
                .add(" to finish moving.");

        // Hide various inputs and panels.
        ui.panel.hide(ui);
        ui.panel.label_input.parent.class_list.add("hidden");
        ui.colour_picker.close();
        ui.focus_point.class_list.remove("focused", "smooth");
        // Add the tooltip.
        ui.element.add(this.tooltip);
    }

    release(ui) {
        this.tooltip.remove();
        if (ui.selection_contains_edge()) {
            ui.panel.element.class_list.remove("hidden");
        }
        ui.panel.label_input.parent.class_list.remove("hidden");
    }
};

/// The UI view is being panned.
UIMode.Pan = class extends UIMode {
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

/// The user is jumping to a cell.
UIMode.Command = class extends UIMode {
    constructor(ui, mode) {
        super();

        this.name = "command";

        ui.panel.label_input.element.value = "";
        this.switch_mode(ui, mode);
        ui.panel.label_input.parent.class_list.remove("hidden");
        ui.panel.label_input.remove_attributes("disabled");
        ui.panel.label_input.element.focus();
    }

    release(ui) {
        const focused_cells = ui.element.query_selector_all(
            ".cell kbd.focused, .cell kbd.partially-focused"
        );
        for (const element of focused_cells) {
            element.class_list.remove("focused", "partially-focused");
            element.clear();
        }
        ui.panel.label_input.element.blur();
        ui.panel.update(ui);
        ui.toolbar.update(ui);
        ui.panel.hide_if_unselected(ui);
    }

    switch_mode(ui, mode) {
        this.mode = mode;
        ui.element.query_selector(".input-mode").replace(this.mode);
    }
};

// We are viewing a diagram embedded in another webpage.
UIMode.Embedded = class extends UIMode {
    constructor() {
        super();

        this.name = "embedded";
    }
}

/// The object responsible for controlling all aspects of the user interface.
class UI {
    constructor(element) {
        // The quiver identified with the UI.
        this.quiver = new Quiver();

        // The UI mode (e.g. whether cells are being rearranged, or connected, etc.).
        this.mode = null;

        // The width and height of each grid cell. Defaults to `default_cell_size`.
        this.cell_width = new Map();
        this.cell_height = new Map();
        // The default (minimum) size of each column and row, if a width or height has not been
        // specified.
        this.default_cell_size = 128;
        // The constraints on the width and height of each cell: we use the maximum constaint for
        // final width/height. We store these separately from `cell_width` and `cell_height` to
        // avoid recomputing the sizes every time, as we access them frequently.
        this.cell_width_constraints = new Map();
        this.cell_height_constraints = new Map();

        // All currently selected cells;
        this.selection = new Set();

        // The element in which to place the interface elements.
        this.element = element;

        // A map from `x,y` positions to vertices. Note that this
        // implies that only one vertex may occupy each position.
        this.positions = new Map();

        // A set of unique idenitifiers for various objects (used for generating HTML `id`s).
        this.ids = new Map();

        // The element containing all the cells themselves.
        this.canvas = null;

        // The grid background.
        this.grid = null;

        // Whether to prevent relayout for individual cell changes so as to batch it instead.
        this.buffer_updates = false;

        // The offset of the view (i.e. the centre of the view).
        this.view = Offset.zero();

        // The scale of the view, as a log of 2. E.g. `scale = 0` is normal, `scale = 1` is 2x
        // zoom, `scale = -1` is 0.5x and so on.
        this.scale = 0;

        // The position of focus for the keyboard, i.e. where new cells will be added if Space is
        // pressed.
        this.focus_position = Position.zero();

        // The element associated with the focus position.
        this.focus_point = null;

        // The size of the view (i.e. the document body dimensions).
        this.dimensions = new Dimensions(document.body.offsetWidth, document.body.offsetHeight);

        // Undo/redo for actions.
        this.history = new History();

        // Keyboard shortcuts.
        this.shortcuts = new Shortcuts(this);

        // A map from cell codes (i.e. IDs) to cells.
        this.codes = new Map();

        // The panel for viewing and editing cell data.
        this.panel = new Panel();

        // The colour picker.
        this.colour_picker = new ColourPicker();

        // The toolbar.
        this.toolbar = new Toolbar();

        // LaTeX macro definitions.
        this.macros = new Map();

        // LaTeX colour definitions.
        this.colours = new Map();

        // The URL from which the macros have been fetched (if at all).
        this.macro_url = null;

        // The user settings, which are stored persistently across sessions in `localStorage`.
        this.settings = new Settings();
    }

    /// Clear the current diagram. This also clears the history.
    clear_quiver() {
        // Clear the existing quiver.
        for (const cell of this.quiver.all_cells()) {
            cell.element.remove();
        }
        this.quiver = new Quiver();

        // Reset data regarding existing vertices.
        this.cell_width = new Map();
        this.cell_height = new Map();
        this.cell_width_constraints = new Map();
        this.cell_height_constraints = new Map();
        this.selection = new Set();
        this.positions = new Map();
        this.update_grid();

        // Clear the undo/redo history.
        this.history = new History();

        // Update UI elements.
        this.panel.update(this);
        this.toolbar.update(this);
        // Reset the focus point.
        this.focus_point.class_list.remove("focused", "smooth");

        // While the following does work without a delay, it currently experiences some stutters.
        // Using a delay makes the transition much smoother.
        delay(() => {
            this.panel.hide(this);
            this.panel.label_input.parent.class_list.add("hidden");
            this.colour_picker.close();
        });
    }

    /// Reset most of the UI. We don't bother resetting current zoom, etc.: just enough to make
    /// changing the URL history work properly.
    reset() {
        // Reset the mode.
        this.switch_mode(UIMode.default);

        // Clear the quiver and update associated UI elements.
        this.clear_quiver();

        // Update UI elements.
        this.panel.dismiss_port_pane(this);
    }

    /// Returns definitions of macros and colours that are recognised by LaTeX.
    definitions() {
        const { macros, colours } = this;
        return { macros, colours };
    }

    /// Returns options that are not saved persistently in `settings`, but are used to modify
    /// export output.
    options() {
        const { macro_url } = this;
        return {
            macro_url,
            dimensions: this.diagram_size(),
            sep: this.panel.sep,
        };
    }

    initialise() {
        this.element.class_list.add("ui");
        this.switch_mode(UIMode.default);

        // Set the grid background.
        this.initialise_grid(this.element);

        // Set up the element containing all the cells.
        this.container = new DOM.Div({ class: "container" }).add_to(this.element);
        this.canvas = new DOM.Div({ class: "canvas" }).add_to(this.container);

        // Set up the panel for viewing and editing cell data.
        this.panel.initialise(this);
        this.element.add(this.panel.element);
        this.colour_picker.initialise(this);
        this.element.add(this.colour_picker.element);
        this.panel.update_position();
        this.element.add(this.panel.global);

        // The label colour picker.
        const shortcut = { key: "Y" };
        const action = () => {
            this.colour_picker.open_or_close(this, ColourPicker.TARGET.Label);
            this.colour_picker.set_colour(this, this.panel.label_colour);
        };
        const colour_indicator = new DOM.Div({ class: "colour-indicator" })
            .listen("click", action);
        this.shortcuts.add([shortcut], (event) => {
            if (!colour_indicator.class_list.contains("disabled")) {
                action(event);
            }
        });
        this.element.add(
            new DOM.Div({ class: "label-input-container hidden" })
                .add(new DOM.Div({ class: "input-mode" }))
                .add(this.panel.label_input)
                .add(colour_indicator)
                .listen(pointer_event("down"), (event) => event.stopPropagation())
        );
        delay(() => {
            this.panel.label_input.parent.add(
                new DOM.Element("kbd", { class: "hint input" })
                    .add(Shortcuts.name([{ key: "Enter" }]))
            );
            this.panel.label_input.parent.add(
                new DOM.Element("kbd", { class: "hint colour" }).add(Shortcuts.name([shortcut]))
            );
        });

        // Prevent the label input being dismissed when clicked on in command mode, when no cells
        // are selected.
        this.panel.label_input.parent.listen(pointer_event("up"), (event) => {
            if (this.in_mode(UIMode.Command)
                && event.button === 0 && event.pointerType !== "touch"
            ) {
                event.stopPropagation();
            }
        });

        // Set up the toolbar.
        this.toolbar.initialise(this);
        this.element.add(this.toolbar.element);

        // Set up the keyboard shortcuts, and about, panes.
        const panes = [];

        // Set up the keyboard shortcuts pane.
        // For now, we simply keep this in sync with the various keyboard shortcuts manually.
        panes.push(new DOM.Div({ id: "keyboard-shortcuts-pane", class: "pane hidden" })
            .add(
                new DOM.Element("h1")
                    .add("Keyboard shortcuts")
                    .add(Shortcuts.element(
                        new DOM.Element("span", { class: "right" }),
                        [{ key: "/", modifier: true }],
                    ))
            )
            .add(new DOM.Element("h2").add("General"))
            .add(new DOM.Table([
                ["Dismiss errors, and panels;\nCancel modification or movement;\n"
                    + "Hide focus point;\nDeselect, and dequeue cells", (td) =>
                        Shortcuts.element(td, [{ key: "Escape" }])],
                ["Import tikz-cd", (td) => Shortcuts.element(td, [{ key: "I", modifier: true }])],
                ["Export to LaTeX", (td) => Shortcuts.element(td, [{ key: "E", modifier: true }])]
            ]))
            .add(new DOM.Element("h2").add("Navigation"))
            .add(new DOM.Table([
                ["Pan view", "Scroll"],
                // Technically "pointer panning", but "mouse panning" is likely less confusing
                // overall for users.
                ["Enable mouse panning", (td) => Shortcuts.element(td, [
                    { key: "Control" }, { key: "Alt" }
                ])],
                ["Enable touch panning", "Long press"],
                ["Enable mouse zooming", (td) => Shortcuts.element(td, [
                    { key: "Shift" }
                ])],
                ["Move focus point", (td) => Shortcuts.element(td, [
                    { key: "ArrowLeft" },
                    { key: "ArrowUp" },
                    { key: "ArrowDown" },
                    { key: "ArrowRight" },
                ])],
                ["Select next queued cell", (td) => Shortcuts.element(td, [{ key: "Tab" }])],
                ["Select previous queued cell", (td) => Shortcuts.element(td, [
                    { key: "Tab", shift: true }
                ])],
                ["Select / deselect object", (td) => Shortcuts.element(td, [{ key: "S" }])],
                ["Select cells", (td) => Shortcuts.element(td, [{ key: ";" }])],
                ["Toggle cell selection", (td) => Shortcuts.element(td, [
                    { key: "'" }
                ])],
            ]))
            .add(new DOM.Element("h2").add("Modification"))
            .add(new DOM.Table([
                ["Focus / defocus label input", (td) => Shortcuts.element(td, [{ key: "Enter" }])],
                ["Create object, and connect to selection", (td) => Shortcuts.element(td, [
                    { key: " " }
                ])],
                ["Move selected objects", (td) => Shortcuts.element(td, [{ key: "B" }])],
                ["Change source", (td) => Shortcuts.element(td, [{ key: "," }])],
                ["Change target", (td) => Shortcuts.element(td, [{ key: "." }])],
                ["Create arrows from selection", (td) => Shortcuts.element(td, [{ key: "/" }])],
            ]))
            .add(new DOM.Element("h2").add("Styling"))
            .add(new DOM.Table([
                ["Reverse arrows", (td) => Shortcuts.element(td, [{ key: "R" }])],
                ["Flip arrows", (td) => Shortcuts.element(td, [{ key: "E" }])],
                ["Flip labels", (td) => Shortcuts.element(td, [{ key: "F" }])],
                ["Left-align labels", (td) => Shortcuts.element(td, [{ key: "V" }])],
                ["Centre-align labels", (td) => Shortcuts.element(td, [{ key: "C" }])],
                ["Over-align labels", (td) => Shortcuts.element(td, [{ key: "X" }])],
                ["Modify label position", (td) => Shortcuts.element(td, [{ key: "I" }])],
                ["Modify offset", (td) => Shortcuts.element(td, [{ key: "O" }])],
                ["Modify curve", (td) => Shortcuts.element(td, [{ key: "K" }])],
                ["Modify radius", (td) => Shortcuts.element(td, [{ key: "N" }])],
                ["Modify length", (td) => {
                    Shortcuts.element(td, [{ key: "L" }]);
                    td.add(" (hold ");
                    // The `span` here is to avoid a CSS `margin-left` rule.
                    Shortcuts.element(td.add(new DOM.Element("span")), [{ key: "Shift" }]);
                    td.add(" to shorten symmetrically)");
                }],
                ["Modify level", (td) => Shortcuts.element(td, [{ key: "M" }])],
                ["Modify style", (td) => Shortcuts.element(td, [{ key: "D" }])],
                ["Display as arrow", (td) => Shortcuts.element(td, [{ key: "A" }])],
                ["Display as adjunction", (td) => Shortcuts.element(td, [{ key: "J" }])],
                ["Display as pullback/pushout", (td) => {
                    Shortcuts.element(td, [{ key: "P" }]);
                    td.add(" (press again to switch corner style)");
                }],
                ["Modify label colour", (td) => Shortcuts.element(td, [{ key: "Y" }])],
                ["Modify arrow colour", (td) => Shortcuts.element(td, [{ key: "U" }])]
            ]))
            .add(new DOM.Element("h2").add("Toolbar"))
            .add(new DOM.Table([
                ["Save diagram in URL", (td) => Shortcuts.element(td, [
                    { key: "S", modifier: true }
                ])],
                ["Undo", (td) => Shortcuts.element(td, [{ key: "Z", modifier: true }])],
                ["Redo", (td) => Shortcuts.element(td, [
                    { key: "Z", modifier: true, shift: true }
                ])],
                ["Select all", (td) => Shortcuts.element(td, [{ key: "A", modifier: true }])],
                ["Deselect all", (td) => Shortcuts.element(td, [
                    { key: "A", modifier: true, shift: true }
                ])],
                ["Delete", (td) => Shortcuts.element(td, [
                    { key: "Backspace" }, { key: "Delete" }
                ])],
                ["Centre view", (td) => Shortcuts.element(td, [{ key: "G" }])],
                ["Zoom out", (td) => Shortcuts.element(td, [{ key: "-", modifier: true }])],
                ["Zoom in", (td) => Shortcuts.element(td, [{ key: "=", modifier: true }])],
                ["Toggle grid", (td) => Shortcuts.element(td, [{ key: "H" }])],
                ["Toggle help", (td) => Shortcuts.element(td, [{
                    key: "H", modifier: true, shift: true
                }])]
            ]))
            .add(new DOM.Element("h2").add("Export"))
            .add(new DOM.Table([
                ["Toggle diagram centring", (td) => Shortcuts.element(td, [{ key: "C" }])],
                ["Toggle ampersand replacement", (td) => Shortcuts.element(td, [{ key: "A" }])],
                ["Toggle cramped spacing", (td) => Shortcuts.element(td, [{ key: "R" }])],
                ["Toggle fixed size", (td) => Shortcuts.element(td, [{ key: "F" }])],
            ])));

        // Set up the "About" pane.
        panes.push(new DOM.Div({ id: "about-pane", class: "pane hidden" })
            .add(new DOM.Element("h1").add("About"))
            .add(new DOM.Element("p").add(new DOM.Element("b").add("quiver")).add(
                " is a modern, graphical editor for commutative and pasting " +
                "diagrams, capable of rendering high-quality diagrams for screen viewing, and " +
                "exporting to LaTeX via "
            ).add(new DOM.Code("tikz-cd")).add("."))
            .add(new DOM.Element("p")
                .add("Creating and modifying diagrams with ")
                .add(new DOM.Element("b").add("quiver"))
                .add(
                    " is orders of magnitude faster than writing the equivalent LaTeX by hand " +
                    "and, with a little experience, competes with pen-and-paper."
                )
            )
            .add(new DOM.Element("p")
                .add("The editor is open source and may be found ")
                .add(new DOM.Link("https://github.com/varkor/quiver", "on GitHub", true))
                .add(
                    ". If you would like to request a feature, or want to report an issue, you can "
                ).add(new DOM.Link("https://github.com/varkor/quiver/issues", "do so here", true))
                .add(".")
            )
            .add(new DOM.Element("p").add("You can follow ")
                .add(new DOM.Element("b").add("quiver")).add(" on ")
                .add(new DOM.Link("https://mathstodon.xyz/@quiver", "Mastodon", true))
                .add(" or ")
                .add(new DOM.Link("https://twitter.com/q_uiver_app", "Twitter", true))
                .add(" for updates on new features.")
            )
            .add(new DOM.Element("h2").add("Thanks to"))
            .add(new DOM.List(false, [
                new DOM.Element("li").add(
                    new DOM.Link("https://www.cl.cam.ac.uk/~scs62/", "S. C. Steenkamp", true)
                ).add(", for helpful discussions regarding the aesthetic rendering of arrows."),
                new DOM.Element("li").add(
                    new DOM.Link(
                        "https://tex.stackexchange.com/users/138900/andr%c3%a9c",
                        "AndréC",
                        true,
                    )
                ).add(", for the custom TikZ style for curves of a fixed height."),
                new DOM.Element("li").add(
                    new DOM.Link("https://github.com/doctorn", "Nathan Corbyn", true)
                ).add(", for adding the ability to export embeddable diagrams to HTML."),
                new DOM.Element("li").add(
                    new DOM.Link("https://github.com/paolobrasolin", "Paolo Brasolin", true)
                ).add(", for adding offline support."),
                new DOM.Element("li").add(
                    new DOM.Link("https://github.com/davidson16807", "Carl Davidson", true)
                ).add(", for discussing and prototyping loop rendering."),
                new DOM.Element("li").add(
                    "Everyone who has improved "
                ).add(new DOM.Element("b").add("quiver"))
                .add(" by reporting issues or suggesting improvements.")
            ]))
            .add(new DOM.Element("footer")
                .add("Created by ")
                .add(new DOM.Link("https://github.com/varkor", "varkor", true))
                .add(".")
            )
        );

        // The version of quiver last used by the user. If they have not used quiver before, this
        // will be `null`. If it's `null`, we display the welcome pane. If it's non-null, but
        // doesn't match the current version of quiver, we may display the new features of the
        // current version of quiver. Otherwise, we do nothing.
        const version_previous_use = window.localStorage.getItem("version-previous-use");

        if (version_previous_use) {
            // If the user has used quiver before, update the previous use version.
            // Otherwise, we display a welcome message below, and only update it once the user has
            // acknowledged it.
            window.localStorage.setItem("version-previous-use", CONSTANTS.VERSION);
        }

        // Set up the welcome pane.
        const welcome_pane = new DOM.Div({
            id: "welcome-pane",
            // We only display the welcome pane the first time the user visits quiver.
            class: "pane" + (version_previous_use ? " hidden" : "")
        }).add(new DOM.Element("h1").add("Welcome"))
            .add(new DOM.Element("p").add(new DOM.Element("b").add("quiver")).add(
                " is a modern, graphical editor for commutative and pasting " +
                "diagrams, capable of rendering high-quality diagrams for screen viewing, and " +
                "exporting to LaTeX via tikz-cd."
            ))
            .add(new DOM.Element("p").add(new DOM.Element("b").add("quiver")).add(
                " is intended to be intuitive to use and easy to pick up. Here are a few tips to " +
                "help you get started:"
            ))
            .add(new DOM.List(false, [
                "Click and drag to create new arrows: the source and target objects will be " +
                "created automatically.",
                "Double-click to create a new object.",
                "Edit labels with the input bar at the bottom of the screen.",
                "Click and drag the empty space around a object to move it around.",
                "Hold Shift (⇧) to select multiple cells to edit them simultaneously."
            ]));
        panes.push(welcome_pane);
        new DOM.Element("button").add("Get started").listen("click", () => {
            // There are technically other ways to dismiss the welcome pane (e.g. opening the
            // keyboard shortcuts pane without clicking this button). We choose not to set the
            // `version-previous-use` variable in these edge cases: the user may have dismissed the
            // welcome pane accidentally, in which case refreshing the page will be enough to get
            // the pane back.
            window.localStorage.setItem("version-previous-use", CONSTANTS.VERSION);
            welcome_pane.class_list.add("hidden");
        }).add_to(welcome_pane);

        for (const pane of panes) {
            this.element.add(pane);

            // Prevent propagation of pointer events when interacting with the pane.
            pane.listen(pointer_event("down"), (event) => {
                if (event.button === 0) {
                    event.stopImmediatePropagation();
                }
            });

            // Prevent propagation of scrolling when the cursor is over the pane.
            // This allows the user to scroll the pane when not all the content fits.
            pane.listen("wheel", (event) => {
                event.stopImmediatePropagation();
            }, { passive: true });
        }

        // Add the version information underneath the logo.
        this.element.add(new DOM.Element(
            "span",
            { class: "version hidden" }
        ).add(`Version ${CONSTANTS.VERSION}`));

        // Add the focus point for new nodes.
        this.focus_point = new DOM.Div({ class: "focus-point focused smooth" })
            .add(new DOM.Div({ class: "tooltip" }))
            .add_to(this.canvas);
        this.update_focus_tooltip();
        this.toolbar.update(this);

        // Handle panning via scrolling.
        window.addEventListener("wheel", (event) => {
            // We don't want to scroll anything at all in embedded mode.
            if (this.in_mode(UIMode.Embedded)) {
                return;
            }

            // We don't want to scroll the page while using the mouse wheel.
            event.preventDefault();

            // Hide the focus point if it is visible.
            this.focus_point.class_list.remove("revealed", "pending", "active");

            // If the user is holding shift, then we zoom, otherwise we pan.
            if (event.shiftKey) {
                this.pan_to(this.view, clamp(
                    CONSTANTS.MIN_ZOOM,
                    this.scale - event.deltaY / 100,
                    CONSTANTS.MAX_ZOOM,
                ));
                this.toolbar.update(this);
            } else {
                this.pan_view(new Offset(
                    event.deltaX * 2 ** -this.scale,
                    event.deltaY * 2 ** -this.scale,
                ));
            }
        }, { passive: false });

        // The canvas is only as big as the window, so we need to resize it when the window resizes.
        window.addEventListener("resize", () => {
            // Adjust the grid so that it aligns with the content.
            this.update_grid();

            // Centre the panel.
            this.panel.update_position();
        });

        // Add a move to the history.
        const commit_move_event = () => {
            if (!this.mode.previous.sub(this.mode.origin).is_zero()) {
                // We only want to commit the move event if it actually did moved things.
                this.history.add(this, [{
                    kind: "move",
                    displacements: Array.from(this.mode.selection).map((vertex) => ({
                        vertex,
                        from: vertex.position.sub(this.mode.previous.sub(this.mode.origin)),
                        to: vertex.position,
                    })),
                }]);
            }
        };

        document.addEventListener(pointer_event("move"), (event) => {
            if (this.in_mode(UIMode.Pan)) {
                if (this.mode.key !== null) {
                    // If we're panning, but no longer holding the requisite key, stop.
                    // This can happen if we release the key when the document is not focused.
                    if (!{ Control: event.ctrlKey, Alt: event.altKey }[this.mode.key]) {
                        this.switch_mode(UIMode.default);
                    }
                }
            }
        });

        // We don't want long presses to trigger the context menu on touchscreens. However, we
        // can't distinguish between context menus triggered by touchscreens versus, say,
        // right-clicking. So we manually keep track of whether there are any touch events, and in
        // this case, disable the context menu.
        let is_touching = false;
        // We use long presses to trigger panning mode. We have to detect these manually (in
        // some implementations, long press is equivalent to `contextmenu`, but not all).
        let long_press_timer = null;

        const trigger_on_long_press = (event) => {
            // Long presses enable panning mode.
            this.cancel_creation();
            this.panel.hide_if_unselected(this);
            this.switch_mode(new UIMode.Pan(null));
            const touch = event.touches[0];
            this.mode.origin = this.offset_from_event(touch).sub(this.view);
        };

        document.addEventListener("touchstart", (event) => {
            is_touching = true;
            if (event.touches.length > 1) {
                // Multiple touches can cause strange behaviours, because they don't follow the
                // usual rules (e.g. two consecutive `pointerdown`s without an intervening
                // `pointerup`).
                if (this.in_mode(UIMode.Default)) {
                    this.cancel_creation();
                }
            } else if (long_press_timer === null) {
                long_press_timer = window.setTimeout(
                    () => trigger_on_long_press(event),
                    CONSTANTS.LONG_PRESS_DURATION,
                );
            }
        });

        // Prevent double-tap-to-zoom on iOS.
        document.addEventListener("dblclick", (event) => event.preventDefault());

        // If the touch position moves, we disable the long press. We use `touchmove` instead of
        // `pointermove`, because that has some leeway around minute changes in the position.
        document.addEventListener("touchmove", () => {
            if (!this.in_mode(UIMode.Pan) && long_press_timer !== null) {
                window.clearTimeout(long_press_timer);
                long_press_timer = null;
            }
        });

        // Disable the context menu on touchscreens. See the comment above `is_touching`.
        document.addEventListener("contextmenu", (event) => {
            if (is_touching) {
                // Don't trigger the context menu.
                event.preventDefault();
            }
        });

        // The touch events don't function like pointer events by default, so we manually trigger
        // pointer events from the touch events.

        // The element that is currently being touched.
        let touched_element = null;
        // We have to track touch enter and touch leave events manually, since this is not directly
        // available. One might imagine that the `touchmove` event would be ideal for this, but
        // this appears not to trigger for small movements, whereas `pointermove` does.
        document.addEventListener(pointer_event("move"), (event) => {
            if (event.pointerType === "touch") {
                const prev_touched_element = touched_element;
                touched_element = document.elementFromPoint(event.clientX, event.clientY);
                if (touched_element !== prev_touched_element) {
                    // Trigger a `pointerleave` event on the element we are no longer touching.
                    if (prev_touched_element !== null) {
                        // We don't trigger the event if the element that is now being touched is a
                        // child of the previous element.
                        const prev_element_contains_next = touched_element !== null
                            && prev_touched_element.contains(touched_element);
                            if (!prev_element_contains_next) {
                                prev_touched_element.dispatchEvent(
                                    new Event(pointer_event("leave"), { bubbles: true })
                                );
                            }
                    }
                    // Trigger a `pointerenter` event on the element we are now touching.
                    if (touched_element !== null) {
                        touched_element.dispatchEvent(
                            new Event(pointer_event("enter"), { bubbles: true })
                        );
                    }
                }
            }
        });

        // Manually track touch end events, which do not properly trigger `pointerup` events
        // automatically.
        document.addEventListener("touchend", (event) => {
            if (this.in_mode(UIMode.Pan)) {
                this.switch_mode(UIMode.default);
            } if (event.changedTouches.length === 1) {
                const touch = event.changedTouches[0];
                const touched_element = document.elementFromPoint(touch.clientX, touch.clientY);
                if (touched_element !== null) {
                    const pointer_ev = new Event(pointer_event("up"), { bubbles: true });
                    // We overwrite some properties that are necessary for `pointerup` listeners.
                    pointer_ev.button = 0;
                    pointer_ev.pageX = touch.pageX;
                    pointer_ev.pageY = touch.pageY;
                    touched_element.dispatchEvent(pointer_ev);
                }
            }
            is_touching = false;
            if (long_press_timer !== null) {
                window.clearTimeout(long_press_timer);
                long_press_timer = null;
            }
            touched_element = null;
        });

        document.addEventListener(pointer_event("up"), (event) => {
            if (event.button === 0) {
                if (event.pointerType !== "touch") {
                    if (this.in_mode(UIMode.Pan)) {
                        // We only want to pan when the pointer is held.
                        this.mode.origin = null;
                    } else if (this.in_mode(UIMode.PointerMove)) {
                        commit_move_event();
                        this.switch_mode(UIMode.default);
                    } else if (this.in_mode(UIMode.Connect)) {
                        // Stop trying to connect cells when the pointer is released outside
                        // the `<body>`.
                        if (this.mode.forged_vertex) {
                            this.history.add(this, [{
                                kind: "create",
                                cells: new Set([this.mode.source]),
                            }]);
                        }
                        this.switch_mode(UIMode.default);
                    }
                }
                this.panel.hide_if_unselected(this);
            }
        });

        this.reposition_focus_point(Position.zero());

        this.element.listen(pointer_event("down"), (event) => {
            if (event.button === 0) {
                // Usually, if `Alt` or `Control` have been held we will have already switched to
                // the Pan mode. However, if the window is not in focus, they will not have been
                // detected, so we switch modes on pointer click.
                if (this.in_mode(UIMode.Default)) {
                    if (event.altKey) {
                        this.switch_mode(new UIMode.Pan("Alt"));
                    } else if (event.ctrlKey) {
                        this.switch_mode(new UIMode.Pan("Control"));
                    } else {
                        this.dismiss_pane();

                        if (this.focus_point.class_list.contains("focused")) {
                            this.focus_point.class_list.remove("focused", "smooth");
                        }

                        // Reveal the focus point upon a click.
                        this.reposition_focus_point(this.position_from_event(event));
                        this.focus_point.class_list.add("revealed", "pending");
                    }
                }
                if (this.in_mode(UIMode.Pan)) {
                    // Hide the focus point if it is visible.
                    this.focus_point.class_list.remove("revealed");
                    // Record the position the pointer was pressed at, so we can pan relative
                    // to that location by dragging.
                    this.mode.origin = this.offset_from_event(event).sub(this.view);
                } else if (this.in_mode(UIMode.KeyMove)) {
                    this.switch_mode(UIMode.default);
                } else if (!this.in_mode(UIMode.Modal)) {
                    if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                        // Deselect cells when the pointer is pressed (at least when the
                        // Shift/Command/Control keys are not held).
                        this.deselect();
                    } else {
                        // Otherwise, simply deselect the label input (it's unlikely the user
                        // wants to modify all the cell labels at once).
                        this.panel.label_input.element.blur();
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

        const create_vertex_at_focus_point = (event) => {
            this.focus_point.class_list.remove("revealed");
            // We want the new vertex to be the only selected cell, unless we've held
            // Shift/Command/Control when creating it.
            if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                this.deselect();
            }
            const vertex = create_vertex(this.focus_position);
            this.select(vertex);
            return vertex;
        };

        // We expect `edges.length > 0`.
        const insert_codes_before = (vertex, ...edges) => {
            // When we create a target vertex and an edge simultaneously, the new vertex has to be
            // created first, because the edge needs a target. Therefore, the vertex will get a code
            // assigned before the edge. However, in practice, it feels more natural to cycle to the
            // edge before the vertex, because this aligns with the diagrammatic order. In these
            // situations, we manually insert the edge codes before the vertex code.
            const vertex_code = vertex.code;
            edges.push(vertex);
            for (let i = edges.length - 1; i > 0; --i) {
                edges[i].code = edges[i - 1].code;
            }
            edges[0].code = vertex_code;
            for (const cell of edges) {
                this.codes.set(cell.code, cell);
                const element = cell.element.query_selector("kbd");
                element.set_attributes({ "data-code": cell.code });
            }
        };

        // Clicking on the focus point reveals it, after which another click adds a new node.
        this.focus_point.listen(pointer_event("down"), (event) => {
            if (event.button === 0) {
                if (this.in_mode(UIMode.Default)) {
                    event.preventDefault();
                    // If we prevent the default behaviour, then the global inputs won't be blurred,
                    // so we need to do that manually.
                    const global = this.panel.global;
                    for (const input of global.query_selector_all('input[type="text"]')) {
                        input.element.blur();
                    }
                    if (this.focus_point.class_list.contains("revealed")) {
                        // We only stop propagation in this branch, so that clicking once in an
                        // empty grid cell will deselect any selected cells, but clicking a second
                        // time to add a new vertex will not deselect the new, selected vertex we've
                        // just added. Note that it's not possible to select other cells in between
                        // the first and second click, because leaving the grid cell with the cursor
                        // (to select other cells) hides the focus point again.
                        event.stopPropagation();
                        const vertex = create_vertex_at_focus_point(event);
                        this.history.add(this, [{
                            kind: "create",
                            cells: new Set([vertex]),
                        }]);
                        // When the user is creating a vertex and adding it to the selection,
                        // it is unlikely they expect to edit all the labels simultaneously,
                        // so in this case we do not focus the input.
                        if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                            this.panel.label_input.element.select();
                        }
                    }
                }
            }
        });

        // If we release the pointer while hovering over the focus point, there are two
        // possibilities. Either we haven't moved the pointer, in which case the focus point loses
        // its `"pending"` or `"active"` state; or we have, in which case we're mid-connection and
        // we need to create a new vertex and connect it. We add the event listener to the
        // container, rather than the focus point, so that we don't have to worry about the
        // focus point being exactly the same size as a grid cell (there is some padding for
        // aesthetic purposes) or the focus point being covered by other elements (like edge
        // endpoints).
        this.container.listen(pointer_event("up"), (event) => {
            if (event.button === 0 && event.pointerType !== "touch") {
                // Handle pointer releases without having moved the cursor from the initial cell.
                this.focus_point.class_list.remove("pending", "active");

                // We only want to create a connection if the focus point is visible. E.g. not
                // if we're hovering over a grid cell that contains a vertex, but not hovering over
                // the vertex itself (i.e. the whitespace around the vertex).
                if (this.focus_point.class_list.contains("revealed")) {
                    // When releasing the pointer over an empty grid cell, we want to create a new
                    // cell and connect it to the source.
                    if (this.in_mode(UIMode.Connect)) {
                        event.stopImmediatePropagation();
                        // We only want to forge vertices, not edges (and thus 1-cells).
                        if (this.mode.source.is_vertex()) {
                            // Usually this vertex will be immediately deselected, except when Shift
                            // is held, in which case we want to select the forged vertices *and*
                            // the new edge.
                            this.mode.target = create_vertex_at_focus_point(event);
                            const created = new Set([this.mode.target]);
                            const actions = [{
                                kind: "create",
                                cells: created,
                            }];

                            if (this.mode.forged_vertex) {
                                created.add(this.mode.source);
                            }

                            if (this.mode.reconnect === null) {
                                // If we're not reconnecting an existing edge, then we need
                                // to create a new one.
                                const edge = this.mode.connect(this, event);
                                created.add(edge);
                                insert_codes_before(this.mode.target, edge);
                            } else {
                                // Unless we're holding Shift/Command/Control (in which case we just
                                // add the new vertex to the selection) we want to focus and select
                                // the new vertex.
                                const { edge, end } = this.mode.reconnect;
                                if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                                    this.panel.label_input.element.select();
                                }
                                actions.push({
                                    kind: "connect",
                                    edge,
                                    end,
                                    from: edge[end],
                                    to: this.mode.target,
                                });
                                this.mode.connect(this, event);
                            }

                            // If we've forged a source vertex, then we select the source, which
                            // allows us to tab sequentially through the source, morphism, and
                            // target.
                            if (this.mode.forged_vertex) {
                                if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                                    this.deselect();
                                    this.select(this.mode.source);
                                    this.panel.hide_if_unselected(this);
                                    if (event.isTrusted) {
                                        // Don't focus the input on touchscreens, since this can be
                                        // offputting, as it often brings up a virtual keyboard.
                                        this.panel.focus_label_input();
                                    }
                                }
                            }

                            this.history.add(
                                this,
                                actions,
                                false,
                                this.selection_excluding(created),
                            );
                        }
                        this.switch_mode(UIMode.default);
                    }
                }
            }
        });

        // If the cursor leaves the focus point and the pointer has *not*
        // been held, it gets hidden again. However, if the cursor leaves the
        // focus point whilst remaining held, then the focus point will
        // be `"active"` and we create a new vertex and immediately start
        // connecting it to something (possibly an empty grid cell, which will
        // create a new vertex and connect them both).
        this.focus_point.listen(pointer_event("leave"), (event) => {
            if (event.pointerType !== "touch") {
                this.focus_point.class_list.remove("pending");

                if (this.focus_point.class_list.contains("active")) {
                    // If the focus point is `"active"`, we're going to create
                    // a vertex and start connecting it.
                    this.focus_point.class_list.remove("active");
                    const vertex = create_vertex_at_focus_point(event);
                    this.switch_mode(new UIMode.Connect(this, vertex, true));
                    vertex.element.class_list.add("source");
                } else if (!this.in_mode(UIMode.Connect)) {
                    // If the cursor leaves the focus point and we're *not*
                    // connecting anything, then hide it.
                    this.focus_point.class_list.remove("revealed");
                }
            }
        });

        // Moving the focus point, panning, and rearranging cells.
        this.element.listen(pointer_event("move"), (event) => {
            if (this.in_mode(UIMode.Pan) && this.mode.origin !== null) {
                const new_offset = this.offset_from_event(event).sub(this.view);
                this.pan_view(this.mode.origin.sub(new_offset));
                this.mode.origin = new_offset;
            }

            // If we move the pointer (without releasing it) while the focus
            // point is revealed, it will transition from a `"pending"` state
            // to an `"active"` state. Moving the pointer off the focus
            // point in this state will create a new vertex and trigger the
            // connection mode.
            if (this.focus_point.class_list.contains("pending")) {
                this.focus_point.class_list.remove("pending");
                this.focus_point.class_list.add("active");
            }

            const position = this.position_from_event(event);

            // Moving cells around with the pointer.
            if (this.in_mode(UIMode.PointerMove)) {
                // Prevent dragging from selecting random elements.
                event.preventDefault();

                const new_position = (cell) => cell.position.add(position).sub(this.mode.previous);

                // We will only try to reposition if the new position is actually different
                // (rather than the cursor simply having moved within the same grid cell).
                // On top of this, we prevent vertices from being moved into grid cells that
                // are already occupied by vertices.
                const occupied = Array.from(this.mode.selection).some((cell) => {
                    return cell.is_vertex() && this.positions.has(`${new_position(cell)}`);
                });

                if (!position.eq(this.mode.previous) && !occupied) {
                    // We'll need to move all of the edges connected to the moved vertices,
                    // so we keep track of the root vertices in `moved.`
                    const moved = new Set();
                    // Move all the selected vertices.
                    for (const cell of this.mode.selection) {
                        if (cell.is_vertex()) {
                            cell.set_position(this, new_position(cell));
                            moved.add(cell);
                        }
                    }

                    // Update the column and row sizes in response to the new positions of the
                    // vertices.
                    if (!this.update_col_row_size(...Array.from(moved)
                        // Undo the transformation performed by `new_position`.
                        .map((vertex) => vertex.position.sub(position).add(this.mode.previous))
                    )) {
                        // If we haven't rerendered the entire canvas due to a resize, then
                        // rerender the dependencies to make sure we move all of the edges connected
                        // to cells that have moved.
                        for (const cell of this.quiver.transitive_dependencies(moved)) {
                            cell.render(this);
                        }
                    }

                    this.mode.previous = position;

                    // Update the panel, so that the interface is kept in sync (e.g. the
                    // rotation of the label alignment buttons).
                    this.panel.update(this);
                }
            }

            // If the user has currently clicked to place a vertex, or activated keyboard controls,
            // then don't reposition the focus point until the new vertex has been created:
            // otherwise we might move the focus point before the vertex has been created and
            // accidentally place the vertex in the new position of the focus point, rather than
            // the old one.
            if (!this.in_mode(UIMode.Connect) && (this.focus_point.class_list.contains("revealed")
                || this.focus_point.class_list.contains("focused"))
            ) {
                return;
            }

            // We permanently change the focus point position if we are dragging to connect an edge,
            // so that the focus point will be in the location we drag to.
            this.reposition_focus_point(position, this.in_mode(UIMode.Connect));

            // We want to reveal the focus point if and only if it is
            // not at the same position as an existing vertex (i.e. over an
            // empty grid cell).
            if (this.in_mode(UIMode.Connect)) {
                // Prevent dragging from selecting random elements.
                event.preventDefault();

                // We only permit the forgery of vertices, not edges.
                if (this.mode.source.is_vertex() && this.mode.target === null) {
                    this.focus_point.class_list
                        .toggle("revealed", !this.positions.has(`${position}`));
                }

                // Update the position of the cursor.
                const offset = this.offset_from_event(event);
                this.mode.update(this, offset);
            }
        });

        // Add various keyboard shortcuts.

        this.shortcuts.add([{ key: "Enter", context: Shortcuts.SHORTCUT_PRIORITY.Always }], () => {
            if (!this.in_mode(UIMode.Modal)) {
                if (this.in_mode(UIMode.Command)) {
                    // Get the list of IDs to select.
                    const mode = this.mode.mode;

                    const codes = new Set(this.panel.label_input.element.value.split(" "));
                    if (mode === "Select") {
                        // Deselect all selected cells.
                        this.deselect();
                    }
                    let repositioned_focus_point = false;
                    let final_selection = null;
                    const actions = [];
                    for (const code of codes) {
                        const cell = this.codes.get(code);
                        if (cell !== undefined && this.quiver.contains_cell(cell)) {
                            switch (mode) {
                                case "Select":
                                case "Toggle":
                                    if (!this.selection.has(cell)) {
                                        this.select(cell);
                                    } else {
                                        this.deselect(cell);
                                    }
                                    // Focus on the first vertex that the user typed.
                                    if (!repositioned_focus_point && cell.is_vertex()) {
                                        this.reposition_focus_point(cell.position);
                                        repositioned_focus_point = true;
                                    }
                                    break;
                                case "Source":
                                case "Target":
                                    const end = mode.toLowerCase();
                                    const edges = Array.from(this.selection)
                                        .filter((cell) => cell.is_edge());
                                    for (const edge of edges) {
                                        const source = mode === "Source" ? cell : edge.source;
                                        const target = mode === "Target" ? cell : edge.target;
                                        const valid_connection = UIMode.Connect.valid_connection(
                                            this,
                                            { source: target, target: source }[end],
                                            { source, target }[end],
                                            { end, edge },
                                        );
                                        if (valid_connection) {
                                            actions.push({
                                                kind: "connect",
                                                edge,
                                                end,
                                                from: edge[end],
                                                to: cell,
                                            });
                                            edge.reconnect(this, source, target);
                                        }
                                    }
                                    break;
                                case "Create":
                                    const created = new Set();
                                    for (const source of this.selection) {
                                        const valid_connection = UIMode.Connect.valid_connection(
                                            this,
                                            source,
                                            cell,
                                        );
                                        if (valid_connection) {
                                            created.add(
                                                UIMode.Connect.create_edge(this, source, cell)
                                            );
                                        }
                                    }
                                    if (created.size > 0) {
                                        if (final_selection === null) {
                                            final_selection = new Set();
                                        }
                                        final_selection = new Set([...final_selection, ...created]);
                                        actions.push({
                                            kind: "create",
                                            cells: created,
                                        });
                                    }
                                    break;
                            }
                        }
                    }
                    if (final_selection !== null) {
                        this.deselect();
                        this.select(...final_selection);
                    }
                    if (actions.length > 0) {
                        this.history.add(this, actions);
                    }
                    this.switch_mode(UIMode.default);
                } else {
                    // Toggle the focus of the label input.
                    const input = this.panel.label_input.element;
                    if (document.activeElement !== input) {
                        if (this.selection.size === 0) {
                            // If no cells are selected, check whether there is one targeted by the
                            // keyboard: in this case, select it.
                            const cell_under_focus_point = this.cell_under_focus_point();
                            if (cell_under_focus_point !== null) {
                                this.select(cell_under_focus_point);
                            }
                        }
                        this.panel.defocus_inputs();
                        if (this.selection.size > 0) {
                            this.panel.focus_label_input();
                        }
                    } else {
                        // Pressing Enter "confirms" the currently selected queued cells.
                        this.panel.unqueue_selected(this);
                        input.blur();
                    }
                }
            }
        });

        this.shortcuts.add([
            // We will mostly ignore the Shift key, apart from selecting queued cells.
            { key: "Tab", shift: null, context: Shortcuts.SHORTCUT_PRIORITY.Always },
        ], (event) => {
            if (!this.in_mode(UIMode.Modal)) {
                if (this.in_mode(UIMode.Default)) {
                    this.panel.defocus_inputs();
                    this.cancel_creation();
                    this.focus_point.class_list.remove("focused", "smooth");

                    // If there are any cells in the queue, we may cycle through them using Tab. To
                    // cycle through the cells, we find the first cell in the queue after any
                    // selected cell (queued or not). Holding Shift cycles in reverse order.
                    const unselected = Array.from(
                        this.element.query_selector_all(".cell:not(.selected) kbd.queue")
                    );
                    if (unselected.length > 0) {
                        const sign = !event.shiftKey ? 1 : -1;
                        let select = this.codes.get((
                            sign > 0 ? unselected[0] : unselected[unselected.length - 1]
                        ).get_attribute("data-code"));

                        // Check there is a selected cell. If not, we will use the default `select`
                        // (i.e. the first or last queued cell).
                        if (this.element.query_selector(".cell.selected kbd") !== null) {
                            // Find the first selected cell.
                            const codes = Array.from(this.codes).filter(([, cell]) => {
                                // We currently do not flush the `codes`, so we need to make sure
                                // we're only considering cells that currently exist (and haven't
                                // been deleted).
                                return this.quiver.contains_cell(cell);
                            });
                            const selected_index = codes.findIndex(([, cell]) => {
                                return cell.element.class_list.contains("selected");
                            });
                            // Find the first queued cell after the selected cell.
                            for (
                                let i = selected_index + sign;
                                i !== selected_index;
                                i += sign
                            ) {
                                // When we reach the end (or the start when Shift is pressed), we
                                // cycle back to the beginning, so we eventually iterate through the
                                // entirety of `code` (which has been cyclically shifted).
                                if (i === codes.length) {
                                    i = 0;
                                }
                                if (i === -1) {
                                    i = codes.length - 1;
                                }
                                const [, cell] = codes[i];
                                if (!cell.element.class_list.contains("selected")
                                    && cell.element.query_selector("kbd.queue") !== null
                                ) {
                                    select = cell;
                                    break;
                                }
                            }
                        }

                        // Deselect all other cells.
                        this.deselect();
                        this.select(select);
                        // Update the panel.
                        this.panel.update(this);
                        this.panel.hide_if_unselected(this);
                        // Display the queue.
                        this.element.class_list.add("show-queue");
                        this.toolbar.element.query_selector('.action[data-name="Show queue"] .name')
                            .replace("Hide queue");
                        // Bring up the label input and select the text.
                        this.panel.focus_label_input();
                    } else if (document.activeElement === this.panel.label_input.element) {
                        // After emptying the queue, it is natural to press Tab again to conclude.
                        // In this case, we do not want to bring up the command interface. Thus,
                        // when the label input is focused, Tab instead defocuses everything.
                        this.deselect();
                        this.panel.update(this);
                        this.panel.hide_if_unselected(this);
                    } else if (this.element.query_selector("kbd.queue") !== null) {
                        // In this case, we have no other cells in the queue to switch to. We simply
                        // focus the label input if it is not focused, and otherwise do nothing.
                        this.panel.focus_label_input();
                    }
                } else {
                    this.switch_mode(UIMode.default);
                }
            }
        });

        this.shortcuts.add([
            { key: ",", context: Shortcuts.SHORTCUT_PRIORITY.Defer },
            { key: ".", context: Shortcuts.SHORTCUT_PRIORITY.Defer },
            { key: "/", context: Shortcuts.SHORTCUT_PRIORITY.Defer },
            { key: ";", context: Shortcuts.SHORTCUT_PRIORITY.Defer },
            { key: "'", context: Shortcuts.SHORTCUT_PRIORITY.Defer }
        ], (event) => {
            if (this.in_mode(UIMode.Default) || this.in_mode(UIMode.Command)) {
                if (
                    this.selection_contains_edge()
                        || this.selection.size > 0 && event.key === "/"
                        || event.key === ";"
                        || event.key === "'"
                ) {
                    const mode = {
                        ";": "Select",
                        "'": "Toggle",
                        ",": "Source",
                        ".": "Target",
                        "/": "Create",
                    }[event.key];
                    if (this.in_mode(UIMode.Default)) {
                        // We use `Defer` instead of `Conservative` so that we can switch modes by
                        // pressing the various command keys (when the input will be focused), but
                        // when we are in the default mode, we don't want to trigger command mode
                        // if we are editing any input.
                        if (!this.input_is_active()) {
                            this.panel.defocus_inputs();
                            // We won't actually be creating anything, but the focus point might be
                            // visible, in which case the following will hide it.
                            this.cancel_creation();
                            this.focus_point.class_list.remove("focused", "smooth");
                            this.switch_mode(new UIMode.Command(this, mode));
                        }
                    } else if (this.mode.mode !== mode) {
                        this.mode.switch_mode(this, mode);
                    } else {
                        this.switch_mode(UIMode.default);
                    }
                }
            }
        });

        this.shortcuts.add([
            { key: "Escape", shift: null, context: Shortcuts.SHORTCUT_PRIORITY.Always }
        ], () => {
            // In the following, we return if we perform any successful action. This means Escape
            // will do at most one thing, and the user may press Escape repeatedly if necessary.

            // If an error banner is visible, the first thing Escape will do is dismiss the banner.
            if (UI.dismiss_error()) {
                return;
            }

            // Close any open panes.
            if (this.panel.dismiss_port_pane(this) || this.dismiss_pane()) {
                return;
            }

            if (this.in_mode(UIMode.PointerMove) || this.in_mode(UIMode.KeyMove)) {
                this.switch_mode(UIMode.default);
                return;
            }

            if (this.cancel_creation()) {
                return;
            }

            // Defocus the label input. This works both in normal mode and in command mode.
            const input = this.input_is_active();
            if (input) {
                input.blur();
                return;
            }

            // Defocus any sliders.
            const focused_elements = this.panel.element.query_selector_all(".focused");
            if (focused_elements.length > 0) {
                this.panel.defocus_inputs();
                return;
            }

            // Close the colour picker.
            if (!this.colour_picker.element.class_list.contains("hidden")) {
                this.colour_picker.close();
                return;
            }

            // Defocus selected cells.
            if (this.element.query_selector(".cell.selected")) {
                this.deselect();
                this.panel.hide(this);
                this.panel.label_input.parent.class_list.add("hidden");
                this.colour_picker.close();
                return;
            }

            if (this.focus_point.class_list.contains("focused")) {
                this.focus_point.class_list.remove("focused", "smooth");
                this.toolbar.update(this);
                return;
            }

            // Unqueue queued cells.
            if (this.element.class_list.contains("show-queue")) {
                for (const element of this.element.query_selector_all("kbd.queue")) {
                    element.class_list.remove("queue");
                }
            }
        });

        // Holding Option or Control triggers panning mode (and releasing ends panning mode).
        this.shortcuts.add([
            { key: "Alt", context: Shortcuts.SHORTCUT_PRIORITY.Always },
            { key: "Control", context: Shortcuts.SHORTCUT_PRIORITY.Always },
        ], (event) => {
            if (this.in_mode(UIMode.Default)) {
                this.switch_mode(new UIMode.Pan(event.key));
            }
        }, null, (event) => {
            if (this.in_mode(UIMode.Pan) && this.mode.key === event.key) {
                this.switch_mode(UIMode.default);
            }
        });

        // "B" for "Bring".
        this.shortcuts.add([{ key: "B" }], () => {
            if (this.in_mode(UIMode.Default)) {
                let selection_contains_vertex = this.selection_contains_vertex();
                const cell_under_focus_point = this.cell_under_focus_point();
                if (!selection_contains_vertex && cell_under_focus_point !== null) {
                    this.select(cell_under_focus_point);
                    selection_contains_vertex = true;
                }
                if (selection_contains_vertex) {
                    this.switch_mode(new UIMode.KeyMove(this));
                }
            } else if (this.in_mode(UIMode.KeyMove)) {
                this.switch_mode(UIMode.default);
            }
        });

        // "S" for "Select".
        this.shortcuts.add([{ key: "S" }], () => {
            if (this.in_mode(UIMode.Default)) {
                if (this.focus_point.class_list.contains("focused")) {
                    const cell_under_focus_point = this.cell_under_focus_point();
                    if (cell_under_focus_point !== null) {
                        if (!this.selection.has(cell_under_focus_point)) {
                            this.select(cell_under_focus_point);
                        } else {
                            this.deselect(cell_under_focus_point);
                            this.panel.hide_if_unselected(this);
                        }
                    }
                }
            }
        });

        // Space bar.
        this.shortcuts.add([{ key: " ", shift: null, modifier: null }], (event) => {
            if (this.in_mode(UIMode.Default)) {
                if (this.focus_point.class_list.contains("focused")) {
                    const selected = Array.from(this.codes)
                        .filter(([, cell]) => cell.is_vertex() && this.selection.has(cell));
                    if (!this.positions.has(`${this.focus_position}`)) {
                        const target = create_vertex_at_focus_point(event);
                        // Connect any selected vertices to the target.
                        const edges = selected.map(([, source]) => {
                            return UIMode.Connect.create_edge(this, source, target);
                        });
                        insert_codes_before(target, ...edges);
                        const actions = [{
                            kind: "create",
                            cells: new Set([target, ...edges]),
                        }];
                        this.history.add(
                            this,
                            actions,
                        );
                    } else {
                        const target = this.positions.get(`${this.focus_position}`);
                        selected.forEach(([, source]) => {
                            // The `target` vertex already exists, so it may already be selected.
                            // In this case, we do not want to try to connect it to itself.
                            if (source !== target) {
                                const edge = UIMode.Connect.create_edge(this, source, target);
                                this.history.add(
                                    this,
                                    [{
                                        kind: "create",
                                        cells: new Set([edge]),
                                    }],
                                );
                            }
                        });
                        if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                            this.deselect();
                        }
                        this.select(target);
                    }
                } else {
                    // Move the focus point back to where it was the last time it was moved using
                    // the keyboard (or the user clicked somewhere on the canvas).
                    this.reposition_focus_point(this.focus_position);
                    this.focus_point.class_list.remove("revealed", "pending", "active");
                    this.focus_point.class_list.add("focused");
                    this.toolbar.update(this);
                    delay(() => this.focus_point.class_list.add("smooth"));
                }
            }
        });

        // Use the arrow keys for moving vertices around, as well as changing slider values via the
        // keyboard.
        this.shortcuts.add([
            { key: "ArrowLeft", shift: null },
            { key: "ArrowDown", shift: null },
            { key: "ArrowRight", shift: null },
            { key: "ArrowUp", shift: null },
        ], (event) => {
            let delta = 0;
            if (event.key === "ArrowLeft") {
                --delta;
            }
            if (event.key === "ArrowRight") {
                ++delta;
            }
            if (this.panel.modify_sliders(delta)) {
                // If there were any focused sliders, don't move selected vertices.
                return;
            }

            let position_delta;
            switch (event.key) {
                case "ArrowLeft":
                    position_delta = new Position(-1, 0);
                    break;
                case "ArrowDown":
                    position_delta = new Position(0, 1);
                    break;
                case "ArrowRight":
                    position_delta = new Position(1, 0);
                    break;
                case "ArrowUp":
                    position_delta = new Position(0, -1);
                    break;
            }

            if (this.in_mode(UIMode.Default)) {
                // Reveal the focus point if it wasn't already visible.
                if (!this.focus_point.class_list.contains("focused")) {
                    this.focus_point.class_list.remove("revealed", "pending", "active");
                    this.focus_point.class_list.add("focused");
                    this.toolbar.update(this);
                    // We first reposition to the correct location, then add the delta after adding
                    // the `smooth` class (directly below), so that it animates to the new position.
                    this.reposition_focus_point(this.focus_position);
                    delay(() => {
                        this.focus_point.class_list.add("smooth");
                        this.reposition_focus_point(this.focus_position.add(position_delta));
                    });
                } else {
                    this.reposition_focus_point(this.focus_position.add(position_delta));
                }

                this.update_focus_tooltip();

                // Reposition the view if the focus point is not complete in-view.
                const offset = this.offset_from_position(this.focus_position);
                const width = this.cell_size(this.cell_width, this.focus_position.x);
                const height = this.cell_size(this.cell_height, this.focus_position.y);
                const view = new Dimensions(
                    document.body.offsetWidth / 2 ** this.scale,
                    document.body.offsetHeight / 2 ** this.scale,
                ).sub(Dimensions.diag(CONSTANTS.VIEW_PADDING * 2));
                const pan = Offset.zero();
                // We only adjust in the direction of movement, to avoid issues with edge cases,
                // e.g. where the height of the screen is too small, which can cause panning
                // vertically back and forth with each key press.
                if (position_delta.x !== 0) {
                    // Left.
                    pan.x += Math.min(offset.x - (this.view.x - view.width / 2), 0);
                    // Right.
                    pan.x += Math.max(offset.x + width - (this.view.x + view.width / 2), 0);
                }
                if (position_delta.y !== 0) {
                    // Top.
                    pan.y += Math.min(offset.y - (this.view.y - view.height / 2), 0);
                    // Bottom.
                    pan.y += Math.max(offset.y + height - (this.view.y + view.height / 2), 0);
                }

                const start = performance.now();
                const view_origin = new Offset(this.view.x, this.view.y);
                // We want to transition the view smoothly. We can animate the offset with CSS, but
                // the grid is drawn using a <canvas> and so must be updated manually.
                const partial_pan = () => {
                    requestAnimationFrame(() => {
                        // The panning animation lasts for 0.1 seconds.
                        const x
                            = Math.max(Math.min((performance.now() - start) / (1000 * 0.1), 1), 0);
                        // The definition of the `ease` transition duration in CSS, which is the
                        // default transition and the one we use.
                        const ease = new CubicBezier(
                            Point.zero(),
                            new Point(0.25, 0.1),
                            new Point(0.25, 1.0),
                            Point.diag(1),
                        );

                        // Do a binary search to find the value of `t` corresponding to the x
                        // co-ordinate `x`. The value of `p.y` thereat is the distance through the
                        // animation.
                        let p;
                        let [min, max] = [ease.point(0), ease.point(1)];

                        if (x === 0) {
                            p = min;
                        } else if (x === 1) {
                            p = max;
                        } else if (x > 0 && x < 1) {
                            const EPSILON = 0.01;
                            const BAIL_OUT = 128;
                            let i = 0;
                            while (true) {
                                p = ease.point((max.t + min.t) / 2);
                                if (p.x === x || max.t - min.t <= EPSILON || ++i >= BAIL_OUT) {
                                    break;
                                }
                                if (x > p.x) {
                                    min = p;
                                }
                                if (x < p.x) {
                                    max = p;
                                }
                            }
                        }

                        this.pan_to(view_origin.add(pan.mul(p.y)));
                        if (x < 1) {
                            partial_pan();
                        }
                    })
                };
                partial_pan();
            }

            if (this.in_mode(UIMode.KeyMove)) {
                // Move vertices around.
                const vertices = Array.from(this.selection).filter((cell) => cell.is_vertex());
                if (vertices.length > 0) {
                    // Find the first available space for all selected vertices, in the direction of
                    // the key press.
                    // We are guaranteed to eventually satisfy `all_new_positions_free`, because
                    // diagrams are finite.
                    for (let distance = 1;; ++distance) {
                        for (const vertex of vertices) {
                            this.positions.delete(`${vertex.position}`);
                        }
                        const all_new_positions_free = vertices.every((vertex) => {
                            return !this.positions.has(`${
                                vertex.position.add(position_delta.mul(distance))
                            }`);
                        });
                        for (const vertex of vertices) {
                            this.positions.set(`${vertex.position}`, vertex);
                        }
                        if (all_new_positions_free) {
                            this.history.add(this, [{
                                kind: "move",
                                displacements: vertices.map((vertex) => ({
                                    vertex,
                                    from: vertex.position,
                                    to: vertex.position.add(position_delta.mul(distance)),
                                })),
                            }], true);
                            break;
                        }
                    }
                }
            }
        });

        // Centre the cell at (0, 0) in the view, which looks prettier.
        this.pan_view(Offset.diag(this.default_cell_size / 2));
    }

    /// Returns whether the UI is in a particular mode.
    in_mode(...modes) {
        for (const mode of modes) {
            if (this.mode instanceof mode) {
                return true;
            }
        }
        return false;
    }

    /// Transitions to a `UIMode`.
    switch_mode(mode) {
        if (this.mode === null || this.mode.constructor !== mode.constructor) {
            if (this.mode !== null) {
                // Clean up any state for which this mode is responsible.
                this.mode.release(this);
                if (this.mode.name !== null) {
                    this.element.class_list.remove(this.mode.name);
                }
            }
            this.mode = mode;
            this.toolbar.update(this);
            if (this.mode.name !== null) {
                this.element.class_list.add(this.mode.name);
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
                // If we have just deleted a cell, there may be no constraint data for that offset,
                // in which case the maximum size is simply zero.
                const constraint_sizes = constraints.has(offset) ?
                    Array.from(constraints.get(offset)).map(([_, size]) => size) : [];
                // The size of a column or row is determined by the largest cell.
                const max_size = Math.max(0, ...constraint_sizes);
                const new_size = Math.max(this.default_cell_size, max_size + margin);
                const delta = new_size - this.cell_size(sizes, offset);

                if (delta !== 0) {
                    sizes.set(offset, new_size);
                }

                return delta;
            }

            // We keep a margin around the content of each cell. This gives space for dragging them
            // with the pointer.
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
            // Similarly, the focus point may have changed position.
            if (this.focus_point.class_list.contains("focused")) {
                // Don't animate the size change, which should happen instantaneously.
                this.focus_point.class_list.remove("smooth");
                this.reposition_focus_point(this.focus_position);
                delay(() => this.focus_point.class_list.add("smooth"));
            }
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

    /// Move the focus point to a given position. This will also resize the focus point
    /// appropriately, so this isn't necessarily an idempotent operation.
    reposition_focus_point(position, update_focus_position = true) {
        if (update_focus_position) {
            // Sometimes, we will want to move the focus point element, but not change its
            // remembered position, so that when we press a key (e.g. Space, or one of the arrow
            // keys), the focus point will jump back to where it last was when we used the keyboard.
            this.focus_position = position;
        }
        const offset = this.offset_from_position(position);
        const height = this.cell_size(this.cell_height, position.y) - CONSTANTS.GRID_BORDER_WIDTH;
        this.element.query_selector(".focus-point").set_style({
            left: `${offset.x}px`,
            top: `${offset.y}px`,
            // Resize the focus point appropriately for the grid cell.
            width: `${
                this.cell_size(this.cell_width, position.x) - CONSTANTS.GRID_BORDER_WIDTH}px`,
            height: `${height}px`,
            "padding-top": `${height / 2}px`,
        });
    };

    /// Returns the cell under the focus point, if the focus point is active and such a cell exists.
    /// Otherwise, returns `null`.
    cell_under_focus_point() {
        if (!this.focus_point.class_list.contains("focused")) {
            return null;
        }
        if (this.positions.has(`${this.focus_position}`)) {
            return this.positions.get(`${this.focus_position}`);
        }
        return null;
    }

    /// Updates the tooltip associated to the focus point.
    update_focus_tooltip() {
        const tooltip = this.focus_point.query_selector(".tooltip").clear();
        if (this.focus_point.class_list.contains("revealed")) {
            tooltip.add("Create vertex");
            return;
        }
        const cell = this.cell_under_focus_point();
        if (cell !== null) {
            if (this.selection.has(cell)) {
                if (this.selection.size === 1) {
                    // No tooltip if there's a cell under the focus point, as pressing Space
                    // won't do anything.
                    return;
                }
            }
            if (this.selection.size > 0) {
                tooltip.add("Press Space to connect the selection to this object");
            } else {
                tooltip.add("Press Space to select this object");
            }
            return;
        }
        if (this.selection.size > 0) {
            tooltip.add("Press Space to connect the selection to a new object");
            return;
        } else {
            tooltip.add("Press Space to add a new object");
            return;
        }
    }

    /// Computes the size of the diagram.
    diagram_size() {
        let [width, height] = [0, 0];
        // Compute the extrema of the diagram.
        const bounding_rect = this.quiver.bounding_rect();
        if (bounding_rect === null) {
            return Dimensions.zero();
        }
        const [[x_min, y_min], [x_max, y_max]] = bounding_rect;
        // Sum to compute width and height.
        for (let x = x_min; x <= x_max; ++x) {
            width += this.cell_size(this.cell_width, x);
        }
        for (let y = y_min; y <= y_max; ++y) {
            height += this.cell_size(this.cell_height, y);
        }
        return new Dimensions(width, height);
    }

    /// Scales the diagram so that it fills the available window size.
    scale_to_fit() {
        // Get the available dimensions to work with within the window.
        const window_width = Math.max(0, document.body.clientWidth - 2 * CONSTANTS.EMBED_PADDING);
        const window_height = Math.max(0, document.body.clientHeight - 2 * CONSTANTS.EMBED_PADDING);

        // Compute the size of the diagram.
        const diagram_size = this.diagram_size();
        const scale = window_width > 0 && window_height > 0 ?
            Math.log2(Math.min(
                window_width / diagram_size.width,
                window_height / diagram_size.height
            )) : 0;
        this.pan_view(Offset.zero(), scale);
    }

    /// Returns whether there are any selected vertices.
    selection_contains_vertex() {
        return Array.from(this.selection).some((cell) => cell.is_vertex());
    }

    /// Returns whether there are any selected edges.
    selection_contains_edge() {
        return Array.from(this.selection).some((cell) => cell.is_edge());
    }

    /// Returns the current UI selection, excluding the given `cells`.
    selection_excluding(cells) {
        const selection = new Set(this.selection);
        for (const cell of cells) {
            selection.delete(cell);
        }
        return selection;
    }

    /// Selects specific `cells`. Note that this does *not* deselect any cells that were
    /// already selected. For this, call `deselect()` beforehand.
    select(...cells) {
        let selection_changed = false;
        // The selection set is treated immutably, so we duplicate it here to
        // ensure that existing references to the selection are not modified.
        this.selection = new Set(this.selection);
        for (const cell of cells) {
            if (this.quiver.deleted.has(cell)) {
                // This should not happen in practice, but to avoid bugs, we make sure only to
                // select cells that exist in the diagram. In the past, the history system has
                // occasionally had trouble keeping track of which cells to select.
                continue;
            }
            if (!this.selection.has(cell)) {
                this.selection.add(cell);
                cell.select();
                selection_changed = true;
            }
        }
        if (selection_changed) {
            this.update_focus_tooltip();
            this.panel.update(this);
            this.toolbar.update(this);
            if (this.selection_contains_edge()) {
                this.panel.element.class_list.remove("hidden");
            }
            if (this.selection.size > 0) {
                this.panel.label_input.parent.class_list.remove("hidden");
            }
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

        this.update_focus_tooltip();
        this.panel.update(this);
        this.toolbar.update(this);
    }

    /// Adds a cell to the canvas.
    add_cell(cell) {
        this.canvas.add(cell.element);
        if (cell.is_vertex()) {
            this.positions.set(`${cell.position}`, cell);
            cell.recalculate_size(this);
        }
        this.colour_picker.update_diagram_colours(this);
    }

    /// Removes a cell.
    remove_cell(cell, when) {
        // Remove this cell and its dependents from the quiver and then from the HTML.
        const update_positions = new Set();
        for (const removed of this.quiver.remove(cell, when)) {
            if (removed.is_vertex()) {
                this.positions.delete(`${removed.position}`);
                this.cell_width_constraints.get(cell.position.x).delete(cell);
                this.cell_height_constraints.get(cell.position.y).delete(cell);
                update_positions.add(removed.position);
            }
            this.deselect(removed);
            removed.element.remove();
        }
        this.update_col_row_size(...update_positions);
        this.colour_picker.update_diagram_colours(this);
    }

    /// Cancel the creation of a new vertex or edge via clicking or dragging.
    cancel_creation() {
        let effectful = false;

        // Stop trying to connect cells.
        if (this.in_mode(UIMode.Connect)) {
            if (this.mode.forged_vertex) {
                // If we created a vertex as part of the connection, we need to record
                // that as an action.
                this.history.add(this, [{
                    kind: "create",
                    cells: new Set([this.mode.source]),
                }]);
            }
            this.switch_mode(UIMode.default);
            effectful = true;
        }

        // If we're waiting to start connecting a cell, then we stop waiting.
        const pending = this.element.query_selector(".cell.pending");
        if (pending !== null) {
            pending.class_list.remove("pending");
            effectful = true;
        }

        // If the user has revealed the focus point (and possibly started dragging), hide it
        // again.
        const class_list = this.focus_point.class_list;
        if (
            class_list.contains("revealed") || class_list.contains("pending")
            || class_list.contains("active")
        ) {
            this.focus_point.class_list.remove("revealed", "pending", "active");
            effectful = true;
        }

        return effectful;
    }

    /// Repositions the view by an absolute offset.
    pan_to(offset, zoom = this.scale) {
        this.view.x = offset.x;
        this.view.y = offset.y;
        this.scale = zoom;
        const view = this.view.mul(2 ** this.scale);
        this.canvas.set_style({
            transform: `translate(${-view.x}px, ${-view.y}px) scale(${2 ** this.scale})`,
        });
        this.update_grid();
    }

    /// Repositions the view by a relative offset.
    /// If `offset` is positive, then everything will appear to move towards the top left.
    /// If `zoom` is positive, then everything will grow larger.
    pan_view(offset, zoom = 0) {
        this.pan_to(this.view.add(offset), this.scale + zoom);
    }

    /// Centre the view with respect to the selection, or the entire quiver if no cells are
    /// selected.
    centre_view() {
        let cells;
        if (this.selection.size > 0) {
            cells = this.selection;
        } else if (this.quiver.cells.length > 0 && this.quiver.cells[0].size > 0) {
            cells = this.quiver.cells[0];
        } else {
            return;
        }

        // We want to centre the view on the cells, so we take the range of all cell offsets.
        let min_offset = new Offset(Infinity, Infinity);
        let max_offset = new Offset(-Infinity, -Infinity);
        this.view = Offset.zero();

        for (const cell of cells) {
            if (cell.is_vertex()) {
                // For vertices, we want to include the entire cell they occupy.
                const offset = this.centre_offset_from_position(cell.position);
                const centre = this.cell_centre_at_position(cell.position);
                min_offset = min_offset.min(offset.sub(centre));
                max_offset = max_offset.max(offset.add(centre));
            } else {
                // For edges, we want to include the centre point (for curved edges) and endpoints.
                const offsets = [
                    cell.shape.origin,
                    cell.source.shape.origin,
                    cell.target.shape.origin
                ];
                for (const offset of offsets) {
                    min_offset = min_offset.min(offset);
                    max_offset = max_offset.max(offset);
                }
            }
        }

        this.pan_view(min_offset.add(max_offset).div(2));
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
        // This may not be the label input, e.g. it may be the macros input.
        return document.activeElement.matches('input[type="text"], div[contenteditable]')
            && document.activeElement;
    }

    /// Dismiss any shown ports.
    dismiss_pane() {
        const unhidden_pane = this.element.query_selector(".pane:not(.hidden)");
        if (unhidden_pane !== null) {
            unhidden_pane.class_list.add("hidden");
            this.element.query_selector(".version").class_list.add("hidden");
            return true;
        }
        return false;
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

        return [label.offsetWidth, label.offsetHeight];
    }

    /// Returns the declared macros in a format amenable to passing to KaTeX.
    latex_macros() {
        const macros = {};
        for (const [name, { definition }] of this.macros) {
            // Arities are implicit in KaTeX.
            macros[name] = definition;
        }
        // Disable newlines in KaTeX.
        // This doesn't work as intended, because we want to be able to use newlines in some
        // commands like `\substack`, but KaTeX doesn't redefine newlines for such commands.
        // macros["\\\\"] = "\\";
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
            const error = new DOM.Div({ class: "error-banner hidden" })
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
            delay(() => error.class_list.remove("hidden"));
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
        }
        return false;
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

        // All arrow styles support labels, shifting, and colour.
        style.label_position = options.label_position / 100;
        style.shift = options.offset * CONSTANTS.EDGE_OFFSET_DISTANCE;
        style.colour = options.colour.css();

        switch (options.style.name) {
            case "arrow":
                style.level = options.level;
                // `shorten` is interpreted with respect to the arc length of the arrow.
                const curve = arrow.curve();
                try {
                    const [start, end] = arrow.find_endpoints();
                    const arc_length = curve.arc_length(end.t) - curve.arc_length(start.t);
                    style.shorten.tail = arc_length * options.shorten.source / 100;
                    style.shorten.head = arc_length * options.shorten.target / 100;
                } catch (_) {
                    // If we can't find the endpoints, the arrow isn't being drawn, so we don't
                    // need to bother trying to shorten it.
                }

                // Shape.
                switch (options.shape) {
                    case "bezier":
                        style.shape = CONSTANTS.ARROW_SHAPE.BEZIER;
                        style.curve = options.curve * CONSTANTS.CURVE_HEIGHT * 2;
                        break;
                    case "arc":
                        style.shape = CONSTANTS.ARROW_SHAPE.ARC;
                        const radius = [2, 3, 4][Math.floor(Math.abs(options.radius) / 2)];
                        style.curve = radius * Math.sign(options.radius) * CONSTANTS.LOOP_HEIGHT;
                        style.angle = deg_to_rad(options.angle);
                        break;
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
                    case "arrowhead":
                        style.tails = CONSTANTS.ARROW_HEAD_STYLE.NORMAL;
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

            // Pullback/pushout corner.
            case "corner-inverse":
                style.body_style = CONSTANTS.ARROW_BODY_STYLE.NONE;
                style.heads = CONSTANTS.ARROW_HEAD_STYLE.NONE;
                style.tails = CONSTANTS.ARROW_HEAD_STYLE.CORNER_INVERSE;
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

    /// Load macros and colours from a string. Macros will be expanded in any LaTeX label, whilst
    /// colours appear as a palette group in the colour panel.
    load_macros(definitions) {
        // Here, we ignore `{` and `}` around the command name, but later we check that
        // the brackets at least match.
        const newcommand = /^\\((?:re)?newcommand|DeclareMathOperator)(\*?)\{?\\([a-zA-Z]+)\}?(?:\[(\d)\])?\{(.*)\}$/;
        // It's not clear exactly what the rules for colour names is, so we accept a sensible
        // subset. We don't accept `cymk` for now. We don't validate values in the regex.
        const definecolor = /^\\definecolor\{([a-zA-Z0-9\-]+)\}\{(rgb|RGB|gray|HTML)\}\{((?:\d+(?:\.\d+)?)(?:,(?:\d+(?:\.\d+)?))*|[a-fA-F\d]{6})\}$/;

        const macros = new Map();
        const colours = new Map();

        for (let line of definitions.split("\n")) {
            line = line.trim();
            if (line === "" || line.startsWith("%")) {
                // Skip empty lines and comments.
                continue;
            }

            let match = line.match(newcommand);
            // Check we either have ``{\commandname}` or `\commandname`, but not mismatched
            // brackets.
            if (match !== null && /^\\((re)?newcommand|DeclareMathOperator)\*?(\{\\[a-zA-Z]+\}|\\[a-zA-Z]+[^\}])/.test(line)) {
                const [, kind, star, command, arity = 0, definition] = match;
                if (kind === "DeclareMathOperator" && typeof match[4] !== "undefined") {
                    console.warn(`Operators defined with \`\\DeclareMathOperator\` may take no arguments.`);
                } else {
                    macros.set(`\\${command}`, {
                        definition: kind === "DeclareMathOperator" ? `\\operatorname${star}{${definition}}` : definition,
                        arity,
                    });
                    continue;
                }
            }

            match = line.replace(/\s/g, "").match(definecolor);
            if (match !== null) {
                const [, name, model, value] = match;
                const values = value.split(",").map((x) => parseFloat(x));
                let colour = null;
                switch (model) {
                    case "rgb":
                        if (values.length === 3 && values.every((x) => x <= 1)) {
                            colour = Colour.from_rgba(...values.map((x) => Math.round(x * 255)));
                        }
                        break;
                    case "RGB":
                        if (values.length === 3 && values.every((x) => {
                            return x <= 255 && Number.isInteger(x);
                        })) {
                            colour = Colour.from_rgba(...values);
                        }
                        break;
                    case "gray":
                        if (values.length === 1 && values[0] <= 1) {
                            colour = new Colour(0, 0, Math.round(values[0] * 100));
                        }
                        break;
                    case "HTML":
                        const hex = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i;
                        const components = value.match(hex);
                        if (components !== null) {
                            colour = Colour.from_rgba(
                                parseInt(components[1], 16),
                                parseInt(components[2], 16),
                                parseInt(components[3], 16),
                            );
                        }
                        break;
                    default:
                        console.warn(`Encountered unrecognised colour model: \`${model}\``);
                        continue;
                }
                if (colour !== null) {
                    colour.name = name;
                    colours.set(name, colour);
                } else {
                    console.warn(`Ignoring invalid colour specification for \`${name}\``);
                }
                continue;
            }

            // We should have hit a `continue` by now, unless we couldn't parse the line.
            console.warn(`Ignoring unrecognised definition: \`${line}\``);
        }
        this.macros = macros;
        this.colours = colours;

        // Rerender all the existing labels with the new macro definitions.
        for (const cell of this.quiver.all_cells()) {
            this.panel.render_tex(this, cell);
        }

        // Update the LaTeX colour palette group.
        this.colour_picker.update_latex_colours(this);
    }

    /// Load macros from a URL.
    load_macros_from_url(url) {
        // Reset the stored macro URL. We don't want to store outdated URLs, but we also don't
        // want to store invalid URLs, so we'll set `this.macro_url` when we succeed in fetching the
        // definitions.
        this.macro_url = null;

        const macro_input = this.panel.global.query_selector("input");
        url = url.trim();
        macro_input.element.value = url;

        const success_indicator = macro_input.parent.query_selector(".success-indicator");
        success_indicator.class_list.remove("success", "failure");

        // Clear the error banner if it's an error caused by a previous failure of
        // `load_macros`.
        UI.dismiss_error("macro-load");

        if (url !== "") {
            success_indicator.class_list.add("unknown");
            // CORS is terribly frustrating. We simply want to fetch some text, but are often
            // unable to do so, because CORS is opt-in and most sites have not. To alleviate this
            // problem, we try to prefix URLs that failed to load with the following service
            // (which should surely not be necessary with `credentials: "omit"`). In doing so, we
            // are hoping that the service never becomes malicious.
            const CORS_PROXY = "https://api.allorigins.win/raw?url=";

            const attempt_to_fetch_macros = (url, prefix = "", repeat = true) => {
                fetch(`${prefix}${url}`, { credentials: "omit" })
                    .then((response) => response.text())
                    .then((text) => {
                        this.load_macros(text);
                        this.macro_url = url;
                        success_indicator.class_list.remove("unknown");
                        success_indicator.class_list.add("success");
                        macro_input.element.blur();
                    })
                    .catch(() => {
                        if (repeat && !url.startsWith(CORS_PROXY)) {
                            // Attempt to fetch using cors-anywhere.
                            attempt_to_fetch_macros(url, CORS_PROXY, false);
                            return;
                        }
                        UI.display_error(
                            "Macro definitions could not be loaded " +
                            "from the given URL.",
                            "macro-load",
                        );
                        success_indicator.class_list.remove("unknown");
                        success_indicator.class_list.add("failure");
                    });
            };
            attempt_to_fetch_macros(url);
        } else {
            // If the URL is empty, we simply reset all macro and colour definitions (as if the user
            // had never loaded any macros or colours).
            this.macros = new Map();
            this.colours = new Map();

            // Rerender all the existing labels without the new macro definitions.
            for (const cell of this.quiver.all_cells()) {
                this.panel.render_tex(this, cell);
            }

            // Update the LaTeX colour palette group.
            this.colour_picker.update_latex_colours(this);
        }
    }
}

/// The history system (i.e. undo and redo).
class History {
    constructor() {
        // A list of all actions taken by the user.
        // Each "action" actually comprises a list of atomic actions.
        this.actions = [];

        // The index after the last taken action (usually equal to `this.actions.length`).
        // `0` therefore signifies that no action has been taken (or we've reverted history
        // to that point).
        this.present = 0;

        // We keep track of the state of the editor at the various points in history, e.g. the
        // selection.
        this.states = [new History.State(new Set(), Position.zero())];

        // We allow history events to be collapsed if two consecutive events have the same
        // (elementwise) `collapse` array. This tracks the previous one.
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
        this.states.splice(this.present + 1, this.actions.length - this.present);
        // Update the current state, so that if we undo to it, we restore the exact
        // state we had before making the action.
        const state = new History.State(selection, ui.focus_position);
        this.states[this.present] = state;
        this.actions.splice(this.present, this.actions.length - this.present);
        this.actions.push(actions);

        if (invoke) {
            this.redo(ui);
        } else {
            ++this.present;
        }

        this.states.push(state);
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

    /// Adds a new history event, or collapses it into the previous event if the two match.
    add_or_modify_previous(ui, collapse, new_actions) {
        const actions = this.get_collapsible_actions(collapse);
        if (actions !== null) {
            // If the previous history event was to modify the property `kind`, then we're just
            // going to modify that event rather than add a new one.
            let unchanged = true;
            outer: for (const action of actions) {
                // We require that each `kind` in `new_actions` is unique.
                for (const new_action of new_actions) {
                    if (action.kind === new_action.kind) {
                        // Modify the `to` field of each property modification.
                        action[`${new_action.kind}s`].forEach((modification) => {
                            modification.to = new_action.value;
                            if (modification.to !== modification.from) {
                                unchanged = false;
                            }
                        });
                        continue outer;
                    }
                }
            }
            // Invoke the new property changes immediately.
            this.effect(ui, actions, false);
            if (unchanged) {
                this.pop(ui);
            }
        } else {
            // If this is the start of our property modification, we need to add a new history
            // event.
            this.add_collapsible(ui, collapse, new_actions.map((new_action) => ({
                kind: new_action.kind,
                [`${new_action.kind}s`]: new_action.cells,
            })), true);
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
        this.states.splice(this.present + 1, 1);
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

        // Whether to call `Panel.update` after triggering the events.
        let update_panel = false;
        // Whether to call `ColourPicker.update_diagram_colours` after triggering the events.
        let update_colours = false;

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
                        ui.quiver.add(cell);
                        ui.add_cell(cell);
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
                    break;
                case "label_colour":
                    for (const label_colour of action.label_colours) {
                        label_colour.cell.label_colour = label_colour[to];
                        label_colour.cell.element.query_selector(".label").set_style({
                            color: label_colour.cell.label_colour.css(),
                        });
                    }
                    update_panel = true;
                    update_colours = true;
                    break;
                case "label_alignment":
                    for (const alignment of action.alignments) {
                        alignment.edge.options.label_alignment = alignment[to];
                        alignment.edge.render(ui);
                    }
                    update_panel = true;
                    break;
                case "label_position":
                    for (const label_position of action.label_positions) {
                        label_position.edge.options.label_position = label_position[to];
                        label_position.edge.render(ui);
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
                        if (curve.edge.is_loop()) {
                            continue;
                        }
                        curve.edge.options.curve = curve[to];
                        cells.add(curve.edge);
                    }
                    update_panel = true;
                    break;
                case "radius":
                    // We don't have any special casing for nonstandard plurals :)
                    for (const radius of action.radiuss) {
                        if (!radius.edge.is_loop()) {
                            continue;
                        }
                        radius.edge.options.radius = radius[to];
                        cells.add(radius.edge);
                    }
                    update_panel = true;
                    break;
                case "angle":
                    for (const angle of action.angles) {
                        if (!angle.edge.is_loop()) {
                            continue;
                        }
                        angle.edge.options.angle = angle[to];
                        cells.add(angle.edge);
                    }
                    update_panel = true;
                    break;
                case "length":
                    for (const length of action.lengths) {
                        const [source, target] = length[to];
                        length.edge.options.shorten = { source, target: 100 - target };
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
                            cell.flip(ui, true);
                        }
                    }
                    update_panel = true;
                    break;
                case "flip labels":
                    for (const cell of action.cells) {
                        if (cell.is_edge()) {
                            cell.flip(ui, false);
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
                case "colour":
                    for (const colour of action.colours) {
                        colour.edge.options.colour = colour[to];
                        cells.add(colour.edge);
                    }
                    update_panel = true;
                    update_colours = true;
                    break;
                case "edge_alignment":
                    for (const cell of action.cells) {
                        cell.options.edge_alignment[action.end] =
                            !cell.options.edge_alignment[action.end];
                        cells.add(cell);
                    }
                    update_panel = true;
                    break;
            }
            for (const cell of ui.quiver.transitive_dependencies(cells)) {
                cell.render(ui);
            }
        }

        if (update_panel) {
            ui.panel.update(ui);
            ui.panel.hide_if_unselected(ui);
        }
        if (update_colours) {
            ui.colour_picker.update_diagram_colours(ui);
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
            const state = this.states[this.present];
            ui.select(...state.selection);
            ui.focus_point.class_list.remove("revealed");
            ui.reposition_focus_point(state.focus_position);
            if (update_panel) {
                ui.panel.update(ui);
                ui.panel.hide_if_unselected(ui);
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
            if (this.present < this.states.length) {
                ui.deselect();
                const state = this.states[this.present];
                ui.select(...state.selection);
                ui.focus_point.class_list.remove("revealed");
                ui.reposition_focus_point(state.focus_position);
            }
            if (update_panel) {
                ui.panel.update(ui);
                ui.panel.hide_if_unselected(ui);
            }

            ui.toolbar.update(ui);

            return true;
        }

        return false;
    }
}

/// The data tracked and restored by the history system.
History.State = class {
    constructor(selection, focus_position) {
        // We keep track of cell selection between events to conserve it as expected.
        this.selection = selection;

        // We also keep track of the position of the focus point for keyboard use.
        this.focus_position = focus_position;
    }
};

class Settings {
    constructor() {
        this.data = {
            // Whether to wrap the `tikz-cd` output in `\[ \]`.
            "export.centre_diagram": true,
            // Whether to use `\&` instead of `&` for column separators in tikz-cd output.
            "export.ampersand_replacement": false,
            // Whether to export diagrams with the `cramped` option.
            "export.cramped": false,
            // Whether to use a fixed size for the embedded `<iframe>`, or compute the size based on
            // the diagram.
            "export.embed.fixed_size": false,
            // The width of an HTML embedded diagram in pixels.
            "export.embed.width": CONSTANTS.DEFAULT_EMBED_SIZE.WIDTH,
            // The height of an HTML embedded diagram in pixels.
            "export.embed.height": CONSTANTS.DEFAULT_EMBED_SIZE.HEIGHT,
            // Which variant of the corner to use for pullbacks/pushouts.
            "diagram.var_corner": false,
        };
        try {
            // Try to update the default values with the saved settings.
            this.data = Object.assign(
                this.data,
                JSON.parse(window.localStorage.getItem("settings"))
            );
        } catch (_) {
            // The JSON stored in `settings` was malformed.
        }
    }

    /// Returns a saved user setting, or the default value if a setting has not been modified yet.
    get(setting) {
        return this.data[setting];
    }

    /// Saves a user setting.
    set(setting, value) {
        this.data[setting] = value;
        window.localStorage.setItem("settings", JSON.stringify(this.data));
    }
}

/// A panel for editing cell data.
class Panel {
    constructor() {
        // The panel element.
        this.element = null;

        // The label input element.
        this.label_input = null;

        // Buttons and options affecting the entire diagram (e.g. export, macros).
        this.global = null;

        // The displayed import/export format (`null` if not currently shown).
        this.port = null;

        // The various sliders. We store them in a variable, rather than finding them with
        // `query_selector` as we usually do, because we need access to the `DOM.Multislider`
        // objects, rather than the `DOM.Element`s.
        this.sliders = new Map();

        // The current label colour. This may be different to the colour in the colour picker
        // (likewise for `colour` below).
        this.label_colour = Colour.black();

        // The current edge colour selected in the panel.
        this.colour = Colour.black();

        // The current column and row separation.
        this.sep = { column: 1.8, row: 1.8 };
    }

    /// Set up the panel interface elements.
    initialise(ui) {
        this.element = new DOM.Div({ class: "side panel hidden" });

        // Prevent propagation of pointer events when interacting with the panel.
        this.element.listen(pointer_event("down"), (event) => {
            if (event.button === 0) {
                event.stopImmediatePropagation();
            }
        });

        // Prevent propagation of scrolling when the cursor is over the panel.
        // This allows the user to scroll the panel when not all the elements fit on it.
        this.element.listen("wheel", (event) => {
            event.stopImmediatePropagation();
        }, { passive: true });

        // Local options, such as vertex and edge actions.
        const wrapper = new DOM.Div({ class: "wrapper" }).add_to(this.element);

        // The label.
        this.label_input = new DOM.Element("input", {
            class: "label-input",
            type: "text",
            disabled: true,
        });

        // Prevent propagation of scrolling when the cursor is over the label input.
        // This allows the user to scroll the label input text when not all the content fits.
        this.label_input.listen("wheel", (event) => {
            event.stopImmediatePropagation();
        }, { passive: true });

        // Prevent propagation of pointer events when interacting with the label input.
        this.label_input.listen(pointer_event("down"), (event) => {
            if (event.button === 0) {
                event.stopImmediatePropagation();
            }
        });

        // Handle label interaction: update the labels of the selected cells when
        // the input field is modified.
        this.label_input.listen("input", () => {
            if (!ui.in_mode(UIMode.Command)) {
                const selection = Array.from(ui.selection).filter((cell) => {
                    return cell.label !== this.label_input.element.value;
                });
                if (selection.length === 0) {
                    // It can happen that we receive an event (e.g. `inputType` `historyUndo`)
                    // that has no effect on any label. It is unclear whether this is the
                    // correct behaviour, but we must account for it in any case. In this case,
                    // we do not want to add a history event, as it would be idempotent.
                    return;
                }
                this.unqueue_selected(ui);
                ui.history.add_or_modify_previous(
                    ui,
                    ["label", ui.selection],
                    [{
                        kind: "label",
                        value: this.label_input.element.value,
                        cells: selection.map((cell) => ({
                            cell,
                            from: cell.label,
                            to: this.label_input.element.value,
                        })),
                    }],
                );
            } else {
                // We are jumping to a cell with the entered ID.
                let replaced
                    = this.label_input.element.value
                        // We are going to remove any `|` symbols in the next step, so it's safe
                        // to convert them to any other symbol that will be removed. Then we can use
                        // `|` as a placeholder for the position of the caret, which conveniently
                        // allows us to preserve the position when typing, even after modifying the
                        // input.
                        .replace(/\|/g, " ");
                replaced = replaced.slice(0, this.label_input.element.selectionStart) + "|"
                    + replaced.slice(this.label_input.element.selectionStart);
                switch (ui.mode.mode) {
                    case "Select":
                    case "Toggle":
                    case "Create":
                        replaced = replaced.replace(/[^ASDFJKLGHEIRUCM |]/gi, "");
                        break;
                    case "Source":
                    case "Target":
                        replaced = replaced.replace(/[^ASDFJKLGHEIRUCM|]/gi, "");
                        break;
                }
                // We allow the pattern " | " to appear, just in case the user does decide to go
                // back and insert a code (for whatever reason).
                replaced = replaced
                    .replace(/\s{2,}/g, " ")
                    .replace(/^\s+/, "")
                    .replace(/^\|\s*/, "|")
                    .toUpperCase();

                // While selecting cells, we keep the caret indicator "|" in `replaced`. This allows
                // us to only partially-select codes when we know the user is still typing that code
                // (i.e. the caret is immediately after it).

                const focused_cells = ui.element.query_selector_all(
                    ".cell kbd.focused, .cell kbd.partially-focused"
                );
                for (const element of focused_cells) {
                    element.class_list.remove("focused", "partially-focused");
                    // Only partially-focused cells need clearing.
                    element.clear();
                }
                const highlighted = new Set();
                for (let code of replaced.split(" ")) {
                    const in_progress = code.endsWith("|");
                    code = code.replace(/\|$/, "");
                    if (!highlighted.has(code)) {
                        const element = ui.element.query_selector(`kbd[data-code="${code}"]`);
                        if (element !== null) {
                            element.class_list.add("focused");
                            highlighted.add(code);
                            continue;
                        }
                    }
                    // If the user is in the process of typing a code, partially-select all the
                    // codes that it matches so far.
                    if (in_progress) {
                        const matches_prefix
                            = ui.element.query_selector_all(`kbd[data-code^="${code}"]`);
                        for (const element of matches_prefix) {
                            element.class_list.add("partially-focused");
                            element.clear()
                                .add(new DOM.Element("span", { class: "focused" }).add(code))
                                .add(element.get_attribute("data-code").slice(code.length));
                        }
                    }
                }

                const caret = replaced.indexOf("|");
                replaced = replaced.replace("|", "");
                this.label_input.element.value = replaced;
                this.label_input.element.setSelectionRange(caret, caret);
            }
        }).listen("focus", () => {
            // Close the colour picker.
            ui.colour_picker.close();
        }).listen("blur", () => {
            if (!ui.in_mode(UIMode.Command)) {
                // As soon as the input is blurred, treat the label modification as
                // a discrete event, so if we modify again, we'll need to undo both
                // modifications to completely undo the label change.
                ui.history.permanentise();
            } else {
                ui.switch_mode(UIMode.default);
            }
        });

        const add_button = (title, label, key, action) => {
            const button
                = Panel.create_button_with_shortcut(ui, title, label, { key }, (event) => {
                    this.unqueue_selected(ui);
                    return action(event);
                });
            button.set_attributes({ disabled: true });
            button.add_to(wrapper);
        };

        // The button to reverse an edge.
        add_button("Reverse arrows", "⇌ Reverse", "r", () => {
            ui.history.add(ui, [{
                kind: "reverse",
                cells: ui.selection,
            }], true);
        });

        // The button to flip an edge.
        add_button("Flip arrows", "⥮ Flip", "e", () => {
            ui.history.add(ui, [{
                kind: "flip",
                cells: ui.selection,
            }], true);
        });

        // The button to flip a label.
        add_button("Flip labels", "⥮ Flip labels", "f", () => {
            ui.history.add(ui, [{
                kind: "flip labels",
                cells: ui.selection,
            }], true);
        });

        // The label alignment options.
        this.create_option_list(
            ui,
            wrapper,
            [
                ["left", "Left align label", "left", "v"],
                ["centre", "Centre align label (clear)", "centre", "c"],
                ["over", "Centre align label (over)", "over", "x"],
                ["right", "Right align label", "right"]
            ],
            "label_alignment",
            [],
            false, // `disabled`
            (edges, value) => {
                ui.history.add(ui, [{
                    kind: "label_alignment",
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

        // We'd rather use `input[type="range"]`, but unfortunately these do not support multiple
        // thumbs, which are necessary for the length slider. Therefore, we roll our own. (We could
        // just use a custom slider for multi-thumb settings, but by using them for all settings, we
        // ensure consistency of behaviour and styling.)
        const create_option_slider = (name, tooltip, property, key, range) => {
            const { min, max, step = 1, thumbs = 1, spacing = 0 } = range;
            const slider = new DOM.Multislider(name, min, max, step, thumbs, spacing, {
                class: "disabled",
                "data-name": property,
            });
            slider.label.set_attributes({ title: tooltip });

            slider.listen("input", () => {
                const value = slider.values();
                // Enact the effect of the slider.
                this.unqueue_selected(ui);
                ui.history.add_or_modify_previous(
                    ui,
                    [property, ui.selection],
                    [{
                        kind: property,
                        value,
                        cells: Array.from(ui.selection)
                            .filter(cell => cell.is_edge())
                            .map((edge) => ({
                                edge,
                                from: property !== "length" ? edge.options[property]
                                    : [
                                        edge.options.shorten.source,
                                        100 - edge.options.shorten.target
                                    ],
                                to: value,
                            })),
                    }],
                );
            });

            this.sliders.set(property, slider);

            // Allow sliders to be focused via the keyboard.
            if (key !== null) {
                ui.shortcuts.add([{ key }], () => {
                    if (
                        !this.element.class_list.contains("hidden")
                        && !slider.class_list.contains("disabled")
                    ) {
                        if (slider.class_list.contains("focused")) {
                            // Step through each of the thumbs until the last.
                            const next_thumb = slider.query_selector(".thumb.focused + .thumb");
                            slider.query_selector(".thumb.focused").class_list.remove("focused");
                            if (next_thumb !== null) {
                                next_thumb.class_list.add("focused");
                            } else {
                                slider.class_list.remove("focused");
                            }
                        } else {
                            this.defocus_inputs();
                            slider.class_list.add("focused");
                            slider.query_selector(".thumb").class_list.add("focused");
                        }
                    }
                });

                delay(() => {
                    slider.label
                        .add(new DOM.Element("kbd", { class: "hint slider" })
                        .add(key.toUpperCase()));
                });
            }

            return slider.label.add_to(wrapper);
        };

        // The label position (along the edge) slider.
        create_option_slider("Position", "Label position", "label_position", "i",
            { min: 0, max: 100, step: 10 },
        );

        // The offset slider.
        create_option_slider("Offset", "Arrow offset", "offset", "o", { min: -5, max: 5 });

        // The curve slider.
        create_option_slider("Curve", "Arrow curve", "curve", "k", { min: -5, max: 5 })
            .class_list.add("arrow-style", "nonloop");

        // The radius slider.
        create_option_slider("Radius", "Loop radius", "radius", "n", { min: -5, max: 5, step: 2 })
            .class_list.add("arrow-style", "loop");

        // The angle slider.
        create_option_slider("Angle", "Loop orientation", "angle", null,
            { min: -180, max: 180, step: 45 },
        ).class_list.add("arrow-style", "loop");

        // The length slider, which affects `shorten`.
        create_option_slider("Length", "Arrow length", "length", "l", {
            min: 0,
            max: 100,
            step: 10,
            thumbs: 2,
            spacing: 20,
        }).class_list.add("arrow-style");

        // Allow edges to be shortened symmetrically by holding shift; and allow column and row
        // separation to be changed simultaneously.
        ui.shortcuts.add([{ key: "Shift", context: Shortcuts.SHORTCUT_PRIORITY.Always }], () => {
            this.sliders.get("length").class_list.add("symmetric");
            for (const element of ui.element.query_selector_all(".linked-sliders")) {
                element.class_list.add("linked");
            }
        }, null, () => {
            this.sliders.get("length").class_list.remove("symmetric");
            for (const element of ui.element.query_selector_all(".linked-sliders")) {
                element.class_list.remove("linked");
            }
        });

        // The level slider. We limit to 4 for now because there are issues with pixel perfection
        // (especially for squiggly arrows, e.g. with their interaction with hooked tails) after 4,
        // and it seems unlikely people will want to draw diagrams involving 5-cells or higher.
        const level_slider
            = create_option_slider("Level", "Arrow dimension", "level", "m", {
                min: 1,
                max: CONSTANTS.MAXIMUM_CELL_LEVEL,
        });
        level_slider.class_list.add("arrow-style");

        // The list of tail styles.
        // The lengths of the arrows to draw in the centre style buttons.
        const ARROW_LENGTH = 72; // The body styles.
        const SHORTER_ARROW_LENGTH = 48; // The edge styles.

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

        // To each style for each component (tail, body, head), we associated a number, so the user
        // can select it from the keyboard.
        let key_index = 1;

        // See below for definition. We declare this here so that it is in scope for the
        // events below.
        let progress_style_selection;

        const update_style = (option_list, name) => {
            return (edges, _, data, user_triggered, idempotent) => {
                if (!idempotent) {
                    effect_edge_style_change(user_triggered, () => {
                        edges.forEach((edge) => edge.options.style[name] = data);
                    });
                }
                if (option_list.class_list.contains("focused")) {
                    progress_style_selection();
                } else {
                    this.defocus_inputs();
                }
            };
        };

        // The list of tail styles.
        const tail_styles = this.create_option_list(
            ui,
            wrapper,
            [
                ["mono", "Mono", { name: "mono"}, `${key_index++}`],
                ["none", "No tail", { name: "none" }, `${key_index++}`],
                ["maps to", "Maps to", { name: "maps to" }, `${key_index++}`],
                ["top-hook", "Top hook",
                    { name: "hook", side: "top" }, `${key_index++}`, ["short"]],
                ["bottom-hook", "Bottom hook",
                    { name: "hook", side: "bottom" }, `${key_index++}`, ["short"]],
                ["arrowhead", "Arrowhead", { name: "arrowhead"}, `${key_index++}`],
            ],
            "tail-type",
            ["vertical", "short", "arrow-style", "kbd-requires-focus"],
            true, // `disabled`
            (edges, _, data, user_triggered, idempotent) =>
                update_style(tail_styles, "tail")(edges, _, data, user_triggered, idempotent),
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
        key_index = 1;
        const body_styles = this.create_option_list(
            ui,
            wrapper,
            [
                ["solid", "Solid", { name: "cell" }, `${key_index++}`],
                ["none", "No body", { name: "none" }, `${key_index++}`],
                ["dashed", "Dashed", { name: "dashed" }, `${key_index++}`],
                ["dotted", "Dotted", { name: "dotted" }, `${key_index++}`],
                ["squiggly", "Squiggly", { name: "squiggly" }, `${key_index++}`],
                ["barred", "Barred", { name: "barred" }, `${key_index++}`],
            ],
            "body-type",
            ["vertical", "arrow-style", "kbd-requires-focus"],
            true, // `disabled`
            (edges, _, data, user_triggered, idempotent) =>
                update_style(body_styles, "body")(edges, _, data, user_triggered, idempotent),
            (data) => ({
                length: ARROW_LENGTH,
                options: Edge.default_options(null, {
                    body: data,
                    head: { name: "none" },
                }),
            }),
        );

        // The list of head styles.
        key_index = 1;
        const head_styles = this.create_option_list(
            ui,
            wrapper,
            [
                ["arrowhead", "Arrowhead", { name: "arrowhead" }, `${key_index++}`],
                ["none", "No arrowhead", { name: "none" }, `${key_index++}`],
                ["epi", "Epi", { name: "epi"}, `${key_index++}`],
                ["top-harpoon", "Top harpoon",
                    { name: "harpoon", side: "top" }, `${key_index++}`, ["short"]],
                ["bottom-harpoon", "Bottom harpoon",
                    { name: "harpoon", side: "bottom" }, `${key_index++}`, ["short"]],
            ],
            "head-type",
            ["vertical", "short", "arrow-style", "kbd-requires-focus"],
            true, // `disabled`
            (edges, _, data, user_triggered, idempotent) =>
                update_style(head_styles, "head")(edges, _, data, user_triggered, idempotent),
            (data) => ({
                length: 0,
                options: Edge.default_options(null, {
                    head: data,
                    body: { name: "none" },
                }),
            }),
        );

        // The list of (non-arrow) edge styles.
        const edge_styles = this.create_option_list(
            ui,
            wrapper,
            [
                ["arrow", "Arrow", Edge.default_options().style, "a"],
                ["adjunction", "Adjunction", { name: "adjunction" }, "j"],
                ["corner", "Pullback / pushout", { name: "corner" }, "p"],
                ["corner-inverse", "Pullback / pushout", { name: "corner-inverse" }, "p"],
            ],
            "edge-type",
            ["large", "nonloop"],
            true, // `disabled`
            (edges, _, data, user_triggered) => {
                effect_edge_style_change(user_triggered, () => {
                    for (const edge of edges) {
                        // These edge styles are not applicable to loops.
                        if (edge.is_loop()) {
                            continue;
                        }
                        // We reset `curve`, `radius`, `angle`, `level` and `length` for non-arrow
                        // edges, because that data isn't relevant to them. Otherwise, we set them
                        // to whatever the sliders are currently set to. This will preserve them
                        // under switching between arrow styles, because we don't reset the sliders
                        // when switching.
                        if (data.name !== "arrow") {
                            edge.options.curve = 0;
                            edge.options.level = 1;
                            edge.options.shorten = { source: 0, target: 0 };
                        } else if (edge.options.style.name !== "arrow") {
                            for (const property of ["curve", "radius", "angle", "level"]) {
                                edge.options[property] = this.sliders.get(property).values();
                            }
                            const [source, target] = this.sliders.get("length").values();
                            edge.options.shorten = { source, target: 100 - target };
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

                    // Enable/disable the arrow style buttons.
                    ui.element.query_selector_all(".arrow-style input")
                        .forEach((input) => input.element.disabled = data.name !== "arrow");
                    // Enable/disable the the curve, length, and level sliders.
                    for (const slider of ui.element.query_selector_all(".arrow-style .slider")) {
                        slider.class_list.toggle("disabled", data.name !== "arrow");
                    }

                    // If we've selected the `"arrow"` style, then we need to trigger the
                    // currently-checked buttons and the curve, length, and level sliders so that
                    // we get the expected style, rather than the default style.
                    if (data.name === "arrow") {
                        ui.element.query_selector_all('.arrow-style input[type="radio"]:checked')
                            .forEach((input) => input.dispatch(new Event("change")))
                    } else {
                        this.defocus_inputs();
                    }
                });
            },
            (data) => ({
                length: SHORTER_ARROW_LENGTH,
                options: Edge.default_options(null, data),
            }),
        );

        const corner_button = this.element
            .query_selector(`input[name="edge-type"][value="corner"]`);
        const corner_inverse_button = this.element
            .query_selector(`input[name="edge-type"][value="corner-inverse"]`);
        corner_inverse_button.class_list.add("hidden");

        // When the user clicks on the corner button, it alternates between `corner` and
        // `corner-inverse`.
        const alternate_buttons = [corner_button, corner_inverse_button];
        for (let i = 0; i < alternate_buttons.length; ++i) {
            const button = alternate_buttons[i];
            const next_button = alternate_buttons[(i + 1) % alternate_buttons.length];
            button.listen(pointer_event("up"), () => {
                if (button.element.checked) {
                    button.element.disabled = true;
                    next_button.element.disabled = false;
                    next_button.element.checked = true;
                    const event = new Event("change");
                    // We're abusing `triggered_by_shortcut` a little here.
                    event.triggered_by_shortcut = true;
                    next_button.dispatch(event);
                    delay(() => button.element.disabled = false);
                }
            });
            // The `change` event just triggers when a radio button is checked.
            button.listen("change", () => {
                if (next_button.class_list.contains("hidden")) {
                    // Allow the next button to receive keyboard events if we've just selected this
                    // body style. When either corner style is selected, then neither button is
                    // disabled to allow us to toggle between them by pressing `P`.
                    next_button.element.disabled = false;
                }
                next_button.class_list.add("hidden");
                button.class_list.remove("hidden");
                // Save the user's preference.
                ui.settings.set("diagram.var_corner", button === corner_inverse_button);
            });
        }

        // When any non-corner edge type is selected, we disable the edge type that is hidden, so
        // that the correct corner style will receive the keyboard event. A similar thing happens
        // in `Panel.update`.
        for (const edge_type_button of this.element.query_selector_all('input[name="edge-type"]')) {
            if (!alternate_buttons.find((button) => button.element === edge_type_button.element)) {
                edge_type_button.listen("change", () => {
                    for (const corner_button of alternate_buttons) {
                        corner_button.element.disabled
                            = corner_button.class_list.contains("hidden");
                    }
                });
            }
        }

        progress_style_selection = () => {
            const elements = [head_styles, body_styles, tail_styles];
            while (elements.length > 0) {
                const first = elements.pop();
                if (first.class_list.contains("focused")) {
                    first.class_list.remove("focused");
                    if (elements.length > 0) {
                        const second = elements.pop();
                        second.class_list.remove("next-to-focus");
                        second.class_list.add("focused");
                        if (elements.length > 0) {
                            const third = elements.pop();
                            third.class_list.add("next-to-focus");
                        }
                    } else {
                        tail_styles.class_list.add("next-to-focus");
                    }
                    return;
                }
            }
            this.defocus_inputs();
            tail_styles.class_list.add("focused");
            tail_styles.class_list.remove("next-to-focus");
            body_styles.class_list.add("next-to-focus");
        };

        // Handle the keyboard shortcuts for changing the arrow style.
        // "D" for "Design".
        ui.shortcuts.add([{ key: "D" }], () => {
            if (ui.selection_contains_edge()) {
                // We can only select an arrow style if that's the edge style that's actually
                // selected.
                if (edge_styles.query_selector(":checked").element.value !== "arrow") {
                    return;
                }
                progress_style_selection();
            }
        });

        delay(() => {
            for (const styles of [head_styles, body_styles, tail_styles]) {
                new DOM.Element("kbd", { class: "hint button triggers-focus" })
                    .add("D")
                    .add_to(styles);
            }
            tail_styles.class_list.add("next-to-focus");
        });

        // The colour indicator. Users can click on the indicator to open the colour picker.
        const shortcut = { key: "U" };
        const action = () => {
            ui.colour_picker.open_or_close(ui, ColourPicker.TARGET.Edge);
            ui.colour_picker.set_colour(ui, this.colour);
        };
        const colour_indicator = new DOM.Div({ class: "colour-indicator" })
            .listen("click", action);
        ui.shortcuts.add([shortcut], (event) => {
            if (!colour_indicator.class_list.contains("disabled")) {
                action(event);
            }
        });
        new DOM.Element("label", { title: "Arrow colour" }).add("Colour: ").add(colour_indicator)
            .add(new DOM.Element("kbd", { class: "hint colour" }).add(Shortcuts.name([shortcut])))
            .add_to(wrapper);

        const change_endpoint_alignment = (element, end) => {
            const cells = new Set();
            for (const cell of ui.selection) {
                if (cell.is_edge() && cell[end].is_edge() &&
                    cell.options.edge_alignment[end] !== element.checked) {
                    cells.add(cell);
                }
            }
            ui.history.add(ui, [{
                kind: "edge_alignment",
                cells,
                end,
            }], true);
        };
        new DOM.Div({
            id: "endpoint-positioning",
            class: "centred hidden",
            title: "Whether to align arrow endpoints to their source/target centre (checked), " +
                "or to their geometric midpoint (unchecked)"
        }).add("Align ")
            .add(new DOM.Element("label", { class: "inline hidden" }).add("source: ").add(
                new DOM.Element("input", { type: "checkbox" }).listen("change", (_, element) => {
                    change_endpoint_alignment(element, "source");
                })
            ))
            .add(new DOM.Element("label", { class: "inline hidden" }).add("target: ").add(
                new DOM.Element("input", { type: "checkbox" }).listen("change", (_, element) => {
                    change_endpoint_alignment(element, "target");
                })
            ))
            .add("to edge")
            .add_to(wrapper);

        const display_port_pane = (kind, format, modify = (output) => output) => {
            // Handle import/export button interaction.
            // If the user clicks on two different imports/exports in a row
            // we will simply switch the displayed import/export format.
            // Clicking on the same button twice closes the panel.
            if (this.port === null || this.port.kind !== kind || this.port.format !== format) {
                ui.switch_mode(new UIMode.Modal());

                // Get the encoding of the diagram. The output may be modified by the caller.
                const { data, metadata } = modify(kind === "import" ?
                    { data: "", metadata: null } :
                    ui.quiver.export(
                        format,
                        ui.settings,
                        ui.options(),
                        ui.definitions(),
                    )
                );

                let port_pane, tip, warning, error, latex_options, embed_options, note, content;
                let textarea, parse_button, import_success;

                // Select the code for easy copying.
                const select_output = () => {
                    const selection = window.getSelection();
                    const range = document.createRange();
                    range.selectNodeContents(content.element);
                    selection.removeAllRanges();
                    selection.addRange(range);
                };

                // Clear any errors and warnings.
                const hide_errors_and_warnings = () => {
                    error.clear();
                    error.class_list.add("hidden");
                    warning.clear();
                    warning.class_list.add("hidden");
                    import_success.class_list.add("hidden");
                };

                const update_output = (data, prevent_defocus = false) => {
                    // At present, the data is always a string.
                    content.replace(data);
                    if (prevent_defocus) {
                        return;
                    }
                    select_output();
                    // Safari seems to occasionally fail to select the text immediately, so we
                    // also select it after a delay to ensure the text is selected.
                    delay(select_output);
                };

                if (this.port === null) {
                    // Create the import/export pane.
                    port_pane = new DOM.Div({ class: "port" });

                    // Prevent propagation of scrolling when the cursor is over the import/export
                    // pane. This allows the user to scroll the pane when not all the text fits on
                    // it.
                    port_pane.listen("wheel", (event) => {
                        event.stopImmediatePropagation();
                    }, { passive: true });

                    // Set up the column/row separation sliders. This needs to be done early, because
                    // we access the sliders to get the separation data for `export`.
                    const update_sep_label = (slider) => {
                        const sep = slider.values().toFixed(2);
                        const seps = {
                            "0.45": "Tiny",
                            "0.90": "Small",
                            "1.35": "Script",
                            "1.80": "Normal",
                            "2.70": "Large",
                            "3.60": "Huge",
                        };
                        const sep_name = seps[sep] || `${sep}em`;
                        slider.label.query_selector(".slider-value").clear().add(sep_name);
                    };
                    const sep_sliders = {};
                    const update_sep_slider = (axis) => {
                        this.sep[axis] = sep_sliders[axis].values();
                        // Update the output. We ignore `metadata`, which currently does not
                        // change in response to the settings.
                        const { data } = modify(ui.quiver.export(
                            format,
                            ui.settings,
                            ui.options(),
                            ui.definitions(),
                        ));
                        update_output(data);
                        // Update the label.
                        update_sep_label(sep_sliders[axis]);
                    };
                    for (const axis of ["column", "row"]) {
                        sep_sliders[axis] = new DOM.Multislider(
                            `${{ "column": "Column", "row": "Row" }[axis]} sep.`, 0.45, 3.6, 0.45,
                        ).listen("input", () => {
                            update_sep_slider(axis);
                            if (sep_sliders[axis].label.parent.class_list.contains("linked")) {
                                const other_axis = { column: "row", row: "column" }[axis];
                                sep_sliders[other_axis].thumbs[0].set_value(this.sep[axis]);
                                update_sep_slider(other_axis);
                            }
                        });
                        sep_sliders[axis].thumbs[0].set_value(this.sep[axis]);
                        update_sep_label(sep_sliders[axis]);
                        this.sliders.set(`${axis}_sep`, sep_sliders[axis]);
                    }

                    tip = new DOM.Element("span", { class: "tip hidden" });

                    // Create message regarding, and linking to, `quiver.sty`.
                    const update_package_previous_download = () => {
                        window.localStorage.setItem(
                            "package-previous-download",
                            CONSTANTS.PACKAGE_VERSION,
                        );
                        const update = tip.query_selector(".update");
                        if (update !== null) {
                            update.remove();
                        }
                    };

                    tip.add("Remember to include ")
                        .add(new DOM.Code("\\usepackage{quiver}"))
                        .add(" in your LaTeX preamble. You can install the package using ")
                        .add(new DOM.Link("https://tug.org/texlive/", "TeX Live 2023", true));
                    tip.add(", or ")
                        .add(
                            // We would like to simply use `quiver.sty` here, but,
                            // unfortunately, GitHub pages does not permit overriding the
                            // `content-type` of a resource, and by default `.sty` files are
                            // treated as `application/octet-stream`.
                            new DOM.Element("a", {
                                href: "https://raw.githubusercontent.com/varkor/quiver/master/package/quiver.sty",
                                target: "_blank",
                            }).add("open ")
                                .add(new DOM.Element("code").add("quiver.sty"))
                                .add(" in a new tab")
                            .listen("click", update_package_previous_download)
                        )
                        .add(" to copy-and-paste.")
                        .add_to(port_pane);

                    const centre_checkbox = new DOM.Element("input", {
                        type: "checkbox",
                        "data-setting": "export.centre_diagram",
                    });
                    const ampersand_replacement = new DOM.Element("input", {
                        type: "checkbox",
                        "data-setting": "export.ampersand_replacement",
                    });
                    const cramped = new DOM.Element("input", {
                        type: "checkbox",
                        "data-setting": "export.cramped",
                    });
                    latex_options = new DOM.Div({ class: "options latex hidden" })
                        .add(new DOM.Element("label")
                            .add(centre_checkbox)
                            .add("Centre diagram")
                        )
                        .add(new DOM.Element("label")
                            .add(ampersand_replacement)
                            .add("Ampersand replacement")
                        )
                        .add(new DOM.Element("label")
                            .add(cramped)
                            .add("Cramped")
                        )
                        .add(new DOM.Div({ class: "linked-sliders" })
                            .add(sep_sliders.column.label)
                            .add(sep_sliders.row.label)
                        )
                        .add_to(port_pane);

                    const fixed_size_checkbox = new DOM.Element("input", {
                        type: "checkbox",
                        "data-setting": "export.embed.fixed_size",
                    });
                    const embed_size = {
                        width: new DOM.Element("input", { type: "number", min: "0" }),
                        height: new DOM.Element("input", { type: "number", min: "0" }),
                    };
                    embed_options = new DOM.Div({ class: "options embed hidden" })
                        .add(new DOM.Element("label")
                            .add(fixed_size_checkbox)
                            .add("Fixed size")
                        )
                        .add(new DOM.Element("label").add("Width: ").add(embed_size.width))
                        .add(new DOM.Element("label").add("Height: ").add(embed_size.height))
                        .add_to(port_pane);

                    const checkboxes = [
                        [centre_checkbox, "tikz-cd", "c"],
                        [ampersand_replacement, "tikz-cd", "a"],
                        [cramped, "tikz-cd", "r"],
                        [fixed_size_checkbox, "html", "f"],
                    ];
                    const shortcuts = [];
                    for (const [checkbox, format, key] of checkboxes) {
                        // Add a keyboard shortcut if applicable.
                        if (key !== null) {
                            const shortcut = {
                                key,
                                context: Shortcuts.SHORTCUT_PRIORITY.Always,
                            };
                            new DOM.Element("kbd", { class: "hint button" })
                                .add(Shortcuts.name([shortcut])).add_to(checkbox.parent);
                            shortcuts.push(ui.shortcuts.add([shortcut], () => {
                                const visible_options = port_pane
                                    .query_selector(".options:not(.hidden)");
                                if (visible_options !== null &&
                                    visible_options.contains(checkbox)) {
                                    checkbox.element.checked = !checkbox.element.checked;
                                    checkbox.dispatch(new Event("change"));
                                }
                            }));
                        }
                        // Update the settings when the checkbox changes.
                        checkbox.listen("change", () => {
                            ui.settings.set(
                                checkbox.get_attribute("data-setting"),
                                checkbox.element.checked,
                            );
                            // Update the output. We ignore `metadata`, which currently does not
                            // change in response to the settings.
                            const { data } = modify(ui.quiver.export(
                                format,
                                ui.settings,
                                ui.options(),
                                ui.definitions(),
                            ));
                            update_output(data);
                        });
                        // Prevent the highlighted output from being deselected when changing a
                        // setting.
                        checkbox.listen(pointer_event("up"), (event) => event.preventDefault());
                    }

                    const update_embed_size = (dimension) => {
                        let value = parseFloat(embed_size[dimension].element.value);
                        if (Number.isNaN(value)) {
                            value = CONSTANTS.DEFAULT_EMBED_SIZE[dimension.toUpperCase()];
                        }
                        ui.settings.set(`export.embed.${dimension}`, value);
                        const { data } = modify(ui.quiver.export(
                            "html",
                            ui.settings,
                            ui.options(),
                            ui.definitions(),
                        ));
                        update_output(data, true);
                    };

                    for (const dimension of ["width", "height"]) {
                        const input = embed_size[dimension];
                        input.listen("input", () => update_embed_size(dimension));
                        // Only re-select the output text when we press Enter, so the inputs are
                        // not blurred whilst typing.
                        input.listen("keydown", (event) => {
                            if (event.key === "Enter") {
                                input.element.blur();
                                select_output();
                            }
                        });
                    }

                    error = new DOM.Element("div", { class: "error hidden" }).add_to(port_pane);
                    warning = new DOM.Element("div", { class: "warning hidden" })
                        .add_to(port_pane);

                    note = new DOM.Div({ class: "note" }).add_to(port_pane);

                    content = new DOM.Div({ class: "code" }).add_to(port_pane);

                    // Insert text at the cursor in the `contenteditable`.
                    const insert_text = (text) => {
                        const selection = window.getSelection();
                        const range = selection.getRangeAt(0);
                        range.deleteContents();
                        range.insertNode(document.createTextNode(text));
                        selection.collapseToEnd();
                    };

                    // Display all fragments as normal text, without error or warning styles.
                    const hide_fragments = () => {
                        for (const fragment of textarea.query_selector_all(".fragment")) {
                            fragment.class_list.remove("error", "warning");
                        }
                    };

                    // Parse the text in the `contenteditable` and load the resulting diagram.
                    const parse_text = () => {
                        // Show the loading screen.
                        ui.element.query_selector(".loading-screen").class_list.remove("hidden");
                        hide_errors_and_warnings();
                        // We delay to make sure the loading screen has appeared.
                        delay(() => {
                            // Disable the input and button.
                            textarea.set_attributes({ contenteditable: "false" });
                            parse_button.set_attributes({ disabled: "" });
                            const text = textarea.element.textContent;
                            // Remove the existing diagram. This also clears the undo/redo history.
                            ui.clear_quiver();
                            // The following should never throw an error: any parse errors will be
                            // reported in `diagnostics`.
                            const { diagnostics } = ui.quiver.import(
                                ui,
                                format,
                                text,
                                ui.settings,
                            );
                            // We delay before checking the diagnostics, because some diagnostics
                            // can only be generated after a delay, e.g. diagnostics for `shorten`,
                            // which depends on checking the lengths of edges.
                            delay(() => {
                                // Edges are shortened after initial rendering, so we may need to
                                // rerender them afterwards.
                                ui.quiver.all_cells().filter((cell) => {
                                    return cell.is_edge() && (cell.options.shorten.source > 0 ||
                                        cell.options.shorten.target > 0);
                                }).forEach((edge) => edge.render(ui));

                                // Display the diagnostics.
                                if (diagnostics.length > 0) {
                                    error.clear().add("The ").add(new DOM.Code("tikz-cd"))
                                        .add(" diagram was not imported " +
                                        "successfully, as an error was encountered when parsing:")
                                    warning.clear().add("Note that the imported ")
                                        .add(new DOM.Element("b").add("quiver"))
                                        .add(" diagram may not match the ")
                                        .add(new DOM.Code("tikz-cd"))
                                        .add(" diagram exactly, as certain issues " +
                                        "were encountered when parsing:");

                                    if (diagnostics.some((diagnostic) => {
                                        return diagnostic instanceof Parser.Error
                                    })) {
                                        error.class_list.remove("hidden");
                                    } else {
                                        import_success.class_list.remove("hidden");
                                    }
                                    if (diagnostics.some((diagnostic) => {
                                        return diagnostic instanceof Parser.Warning
                                    })) {
                                        warning.class_list.remove("hidden");
                                    }
                                    const error_list = new DOM.Element("ul").add_to(error);
                                    const warning_list = new DOM.Element("ul").add_to(warning);

                                    // The most complicated part of rendering the diagnostics is
                                    // splitting the input text up into fragments so that we can
                                    // highlight the different parts associated to an error or
                                    // warning. This is done by identifying the endpoints of the
                                    // ranges of all the diagnostics, and splitting up into spans
                                    // representing each possible range (including those formed from
                                    // overlapping ranges).
                                    let endpoints = new Set([0, text.length]);
                                    const fragments_for_diagnostic = new Map();
                                    const diagnostics_for_fragment = new Map();
                                    // Create the list items associated to the diagnostics.
                                    for (const diagnostic of diagnostics) {
                                        fragments_for_diagnostic.set(diagnostic, []);
                                        let { message, range } = diagnostic;
                                        if (range !== null) {
                                            endpoints.add(range.start);
                                            endpoints.add(range.end);
                                        }
                                        const li = new DOM.Element("li")
                                            .listen("mouseenter", () => {
                                            for (const fragment of fragments_for_diagnostic
                                                .get(diagnostic)
                                            ) {
                                                fragment.class_list.add("highlight");
                                            }
                                        }).listen("mouseleave", () => {
                                            for (const fragment of textarea
                                                .query_selector_all(".fragment.highlight")
                                            ) {
                                                fragment.class_list.remove("highlight");
                                            }
                                        });
                                        diagnostic.element = li;
                                        if (typeof message === "string") {
                                            message = [message];
                                        }
                                        message.forEach((part) => li.add(part));
                                        if (diagnostic instanceof Parser.Error) {
                                            error.class_list.remove("hidden");
                                            error_list.add(li);
                                        } else {
                                            warning.class_list.remove("hidden");
                                            warning_list.add(li);
                                        }
                                    }
                                    // Sort the endpoints.
                                    endpoints = Array.from(endpoints);
                                    endpoints.sort((a, b) => a - b);
                                    // We deduplicate endpoints, so that if two ranges end at the
                                    // same position, we don't end up creating multiple fragments.
                                    // However, if there are fragments with zero length, we would
                                    // still like to display them for clarity. Therefore, after
                                    // sorting the `endpoints` array, we go through and check, for
                                    // each endpoint, whether there is a range of zero length at
                                    // that position. If there is, we add an extra index, so that,
                                    // in the next loop, there will be a zero width fragment.
                                    for (let i = 0; i < endpoints.length; ++i) {
                                        const endpoint = endpoints[i];
                                        for (const diagnostic of diagnostics) {
                                            const { range } = diagnostic;
                                            if (
                                                range !== null &&
                                                range.start === endpoint && range.end === endpoint
                                            ) {
                                                endpoints.splice(i, 0, endpoint);
                                                ++i;
                                                break;
                                            }
                                        }
                                    }
                                    // Create the spans associated to the diagnostic fragments, and
                                    // highlight them as necessary.
                                    textarea.clear();
                                    for (let i = 0; i < endpoints.length - 1; ++i) {
                                        const endpoint = endpoints[i];
                                        let substring = text.substring(endpoint, endpoints[i + 1]);
                                        const zero_width = substring.length === 0;
                                        const fragment = new DOM.Element("span", {
                                            class: "fragment"
                                        }).add(substring).listen("mouseenter", () => {
                                            for (const diagnostic of diagnostics_for_fragment
                                                .get(fragment)
                                            ) {
                                                diagnostic.class_list.add("highlight");
                                            }
                                        }).listen("mouseleave", () => {
                                            for (const diagnostic of port_pane
                                                .query_selector_all("li.highlight")
                                            ) {
                                                diagnostic.class_list.remove("highlight");
                                            }
                                        });
                                        diagnostics_for_fragment.set(fragment, []);
                                        for (const diagnostic of diagnostics) {
                                            const { range } = diagnostic;
                                            if (range === null) {
                                                continue;
                                            }
                                            if (
                                                (range.start <= endpoint && range.end > endpoint) ||
                                                (zero_width && range.start === endpoint
                                                    && range.end === endpoint)
                                            ) {
                                                fragments_for_diagnostic
                                                    .get(diagnostic).push(fragment);
                                                diagnostics_for_fragment
                                                    .get(fragment).push(diagnostic.element);
                                                fragment.class_list.add(
                                                    diagnostic instanceof Parser.Error ?
                                                        "error" : "warning"
                                                );
                                            }
                                        }
                                        textarea.add(fragment);
                                    }
                                } else {
                                    // If the parse was successful, i.e. there were no errors or
                                    // warnings, we close the import pane immediately.
                                    this.dismiss_port_pane(ui);
                                }
                                // Regardless of whether the parse was successful or not, we hide
                                // the loading screen once it has been concluded. We delay to ensure
                                // the diagram has been correctly laid out. However, this seems only
                                // partially successful with very large diagrams.
                                delay(() => {
                                    // Make the textarea editable again.
                                    textarea.set_attributes({ contenteditable: "true" });
                                    if (text.length > 0) {
                                        parse_button.remove_attributes("disabled");
                                    }
                                    ui.element.query_selector(".loading-screen").class_list
                                        .add("hidden");
                                });
                            });
                        });
                    };

                    // The `contenteditable` used for the tikz-cd input.
                    textarea = new DOM.Div({
                        // We would like to use "plaintext-only", but Firefox does not support it at
                        // the time of writing.
                        contenteditable: "true",
                        spellcheck: "false",
                        // Note that users must press Shift + Enter to insert a newline. This does
                        // not seem convenient to override, but users should mostly be pasting
                        // code so it should not matter significantly.
                    }).listen("input", () => {
                        // If the user starts editing, we want to hide the warning/error
                        // highlighting, because they will no longer be correct once the text has
                        // been modified.
                        hide_fragments();
                        if (textarea.element.textContent.length > 0) {
                            parse_button.remove_attributes("disabled");
                        } else {
                            parse_button.set_attributes({ disabled: "" });
                        }
                    }).listen("keydown", (event) => {
                        // For some reason, `contenteditable` only inserts newlines when Shift +
                        // Enter is pressed. It does not seem possible to configure this behaviour,
                        // so we have to manually insert newlines.
                        if (event.key === "Enter") {
                            event.preventDefault();
                            // If the command key or control key are held, we trigger a parse of the
                            // text...
                            if (event.metaKey || event.ctrlKey) {
                                parse_text();
                            } else {
                                hide_fragments();
                                // ...otherwise, we insert a newline. This is easier said than done.
                                // There are two additional complexities. The first is that
                                // `textarea` is `pre-whitespace`, which does not display a newline
                                // if it is right at the end of the element. For this reason, in
                                // this situation, we insert an extra newline character. However, it
                                // is not trivial to work out if the caret is at the end of the
                                // element, because `textarea` is not a single text node, but may
                                // contain many `.fragment` spans. This is the reason for the
                                // complexity below.
                                const text = textarea.element.textContent;
                                const range = window.getSelection().getRangeAt(0);
                                const total_range = range.cloneRange();
                                total_range.selectNodeContents(textarea.element);
                                total_range.setEnd(range.startContainer, range.startOffset);
                                total_range.setEnd(range.endContainer, range.endOffset);
                                const caret = total_range.toString().length;
                                if (caret === text.length && !/\n$/.test(text)) {
                                    insert_text("\n");
                                }
                                insert_text("\n");
                            }
                        }
                    }).listen("paste", (event) => {
                        // We wish to import the diagram upon a paste event.
                        // If we rely on the default behaviour, the browser will insert rich text,
                        // which we do not want. Therefore, we paste manually.
                        event.preventDefault();
                        insert_text(event.clipboardData.getData("text/plain"));
                        parse_text();
                    }).add_to(port_pane);

                    parse_button = new DOM.Element("button").add("Import").listen("click", () => {
                        parse_text();
                    }).add_to(port_pane);

                    import_success = new DOM.Element("div", { class: "note" })
                        .add(new DOM.Code("tikz-cd"))
                        .add(" diagram imported successfully. Press ")
                        .add(new DOM.Element("kbd").add("Escape"))
                        .add(" to view the diagram.")
                        .add_to(port_pane);

                    ui.element.add(port_pane);

                    this.port = { shortcuts };
                } else {
                    // Find the existing import/export pane.
                    port_pane = ui.element.query_selector(".port");
                    tip = port_pane.query_selector(".tip");
                    warning = port_pane.query_selector("div.warning");
                    error = port_pane.query_selector("div.error");
                    latex_options = port_pane.query_selector(".options.latex");
                    embed_options = port_pane.query_selector(".options.embed");
                    note = port_pane.query_selector(".note");
                    content = port_pane.query_selector(".code");
                    textarea = port_pane.query_selector('div[contenteditable]');
                    parse_button = port_pane.query_selector('div[contenteditable] + button');
                    import_success = port_pane.query_selector("button + .note");
                }

                // Update the thumbs of the column/row separation sliders now that we can calculate
                // their widths.
                for (const axis of ["column", "row"]) {
                    const slider = this.sliders.get(`${axis}_sep`);
                    slider.thumbs[0].class_list.add("no-transition");
                    delay(() => {
                        slider.thumbs[0].set_value(slider.values());
                        delay(() => {
                            slider.thumbs[0].class_list.remove("no-transition");
                        });
                    });
                }

                // Reposition the error/warning messages depending on the tab.
                switch (kind) {
                    case "export":
                        port_pane.element.insertBefore(error.element, note.element);
                        port_pane.element.insertBefore(warning.element, note.element);
                        break;
                    case "import":
                        port_pane.add(error);
                        port_pane.add(warning);
                        break;
                }

                // Clear any existing errors, which do not persist between tabs.
                hide_errors_and_warnings();

                // Display a warning if necessary.
                const unsupported_items = kind === "export" && format === "tikz-cd" ?
                    Array.from(metadata.tikz_incompatibilities).sort() : [];
                if (unsupported_items.length !== 0) {
                    warning.class_list.remove("hidden");
                    warning.add("The exported ").add(new DOM.Code("tikz-cd"))
                        .add(" diagram may not match the ")
                        .add(new DOM.Element("b").add("quiver"))
                        .add(" diagram exactly, as ").add(new DOM.Code("tikz-cd"))
                        .add(" does not support the following features that " +
                            "appear in this diagram:");
                    const list = new DOM.Element("ul").add_to(warning);
                    for (const [index, item] of unsupported_items.entries()) {
                        list.add(new DOM.Element("li")
                            .add(`${item}${index + 1 < unsupported_items.length ? ";" : "."}`)
                        );
                    }
                }
                const dependencies = kind === "export" && format === "tikz-cd" ?
                    metadata.dependencies : new Map();
                if (dependencies.size !== 0) {
                    warning.class_list.remove("hidden");
                    if (unsupported_items.length !== 0) {
                        warning.add(new DOM.Element("br"));
                    }
                    warning.add("The exported ").add(new DOM.Code("tikz-cd"))
                        .add(" diagram relies upon additional TikZ " +
                        "libraries that you may have to install for the diagram to render " +
                        "correctly:");
                    const list = new DOM.Element("ul").add_to(warning);
                    for (const [library, reasons] of dependencies) {
                        const li = new DOM.Element("li").add_to(list);
                        const url = { "tikz-nfold": "https://ctan.org/pkg/tikz-nfold" }[library];
                        li.add(new DOM.Element("a", { href: url, target: "_blank" })
                            .add(new DOM.Code(library)));
                        li.add(`, for ${Array.from(reasons).join("; ")}.`);
                    }
                }

                // Update the note.
                note.clear();
                if (kind === "import" && format === "tikz-cd") {
                    note.add("Paste a ").add(new DOM.Code("tikz-cd"))
                        .add(" diagram below to load it into ")
                        .add(new DOM.Element("b").add("quiver"))
                        .add(" ↴");
                }
                if (kind === "export") {
                    note.add("If you need to edit this diagram, you can open it again in ")
                        .add(new DOM.Element("b").add("quiver"))
                        .add(" using the URL below ↴");
                }

                // Update the import textarea/button.
                textarea.clear();
                textarea.set_attributes({ "contenteditable": "true" });
                parse_button.set_attributes({ disabled: "" });

                // Show/hide relevant UI elements.
                tip.class_list.toggle("hidden", kind !== "export" || format !== "tikz-cd");
                warning.class_list.toggle("hidden",
                    unsupported_items.length === 0 && dependencies.size === 0,
                );
                latex_options.class_list.toggle(
                    "hidden",
                    kind !== "export" || format !== "tikz-cd",
                );
                embed_options.class_list.toggle("hidden", kind !== "export" || format !== "html");
                const import_tikz_cd = kind !== "import" || format !== "tikz-cd";
                textarea.class_list.toggle("hidden", import_tikz_cd);
                parse_button.class_list.toggle("hidden", import_tikz_cd);

                for (const checkbox of port_pane.query_selector_all('input[type="checkbox"]')) {
                    if (ui.settings.get(checkbox.get_attribute("data-setting"))) {
                        checkbox.set_attributes({ checked: "" });
                    } else {
                        checkbox.remove_attributes("checked");
                    }
                }

                const [embed_width, embed_height] = embed_options
                    .query_selector_all('input[type="number"]');
                embed_width.element.value = ui.settings.get("export.embed.width");
                embed_height.element.value = ui.settings.get("export.embed.height");

                this.port.kind = kind;
                this.port.format = format;
                port_pane.class_list.remove("import", "export");
                port_pane.class_list.add(kind);

                update_output(data);
                if (kind === "import" && format === "tikz-cd") {
                    delay(() => textarea.element.focus());
                }
                // Disable cell data editing while the import/export pane is visible.
                this.update(ui);
            } else {
                this.dismiss_port_pane(ui);
            }
        };

        // The import button.
        const import_from_tikz = Panel.create_button_with_shortcut(
            ui,
            "tikz-cd diagram",
            "tikz-cd",
            { key: "I", modifier: true, context: Shortcuts.SHORTCUT_PRIORITY.Always },
            () => display_port_pane("import", "tikz-cd"),
        ).set_attributes({ class: "short" });

        // The export button.
        const export_to_latex = Panel.create_button_with_shortcut(
            ui,
            "LaTeX",
            "LaTeX",
            { key: "E", modifier: true, context: Shortcuts.SHORTCUT_PRIORITY.Always },
            () => display_port_pane("export", "tikz-cd"),
        );

        this.global = new DOM.Div({ class: "panel global" }).add(
            new DOM.Element("label").add("Import: ")
        ).add(import_from_tikz).add(
            new DOM.Element("label").add("Export: ")
        ).add(
            // The shareable link button.
            new DOM.Element("button").add("Shareable link")
                .listen("click", () => {
                    display_port_pane("export", "base64");
                })
        ).add(
          // The embed button.
          new DOM.Element("button").add("Embed code")
              .listen("click", () => {
                  display_port_pane("export", "html");
              })
        ).add(export_to_latex).add(
            new DOM.Div({ class: "indicator-container" }).add(
                new DOM.Element("label").add("Macros: ")
                    .add(
                        new DOM.Element("input", {
                            type: "text",
                            placeholder: "Paste URL here",
                        }).listen("wheel", (event) => {
                            event.stopImmediatePropagation();
                        }, { passive: true }).listen("keydown", (event, input) => {
                            if (event.key === "Enter") {
                                event.stopPropagation();
                                ui.load_macros_from_url(input.value);
                                input.blur();
                            }
                        }).listen("paste", (_, input) => {
                            delay(() => ui.load_macros_from_url(input.value));
                        })
                    ).add(
                        new DOM.Div({ class: "success-indicator" })
                    )
            )
        );

        // Prevent propagation of pointer events when interacting with the global options.
        this.global.listen(pointer_event("down"), (event) => {
            if (event.button === 0) {
                event.stopImmediatePropagation();
            }
        });
    }

    /// Creates a UI button with an associated keyboard shortcut.
    static create_button_with_shortcut(ui, title, label, shortcut, action) {
        const button = new DOM.Element("button", { title })
            .add(label)
            .listen("click", action);
        ui.shortcuts.add([shortcut], (event) => {
            if (!button.element.disabled) {
                action(event);
                Shortcuts.flash(button);
            }
        });
        delay(() => {
            button.add(
                new DOM.Element("kbd", { class: "hint button" }).add(Shortcuts.name([shortcut]))
            );
        });
        return button;
    }

    // A helper function for creating a list of radio inputs with backgrounds drawn based
    // on `draw_edge` with various arguments. This allows for easily customising edges
    // with visual feedback.
    create_option_list(
        ui,
        wrapper,
        entries,
        name,
        classes,
        disabled,
        on_check,
        properties,
    ) {
        const options_list = new DOM.Div({ class: "options" });
        options_list.class_list.add(...classes);

        const create_option = (value, tooltip, data) => {
            const button = new DOM.Element("input", {
                type: "radio",
                name,
                value,
                title: tooltip,
            }).listen("change", (event, button) => {
                if (button.checked) {
                    this.unqueue_selected(ui);
                    const selected_edges = Array.from(ui.selection).filter(cell => cell.is_edge());
                    on_check(
                        selected_edges,
                        value,
                        data,
                        event.isTrusted || event.triggered_by_shortcut,
                        event.idempotent || false,
                    );
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

            let { length, options, draw_label } = properties(data);

            // We use a custom pre-drawn SVG for the pullback/pushout button.
            if (options.style.name.startsWith("corner")) {
                button.set_style({
                    "background-image": ["", "un"].map((prefix) => {
                        return `url("icons/${
                            options.style.name.endsWith("inverse") ? "var-" : ""
                        }pullback-${prefix}checked.svg")`;
                    }).join(", ")
                });
                return button;
            }

            // Usually heads are drawn with zero length, but for epimorphisms, we need to have some
            // length so that the two arrowheads are spaced out appropriately. Thus, in this case,
            // we add an extra `head_width` to make sure they display properly.
            if (options.style.head.name === "epi") {
                length += CONSTANTS.LINE_SPACING + CONSTANTS.STROKE_WIDTH;
            }

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
                backgrounds.push(`url("data:image/svg+xml;utf8,${
                    encodeURIComponent(svg.element.outerHTML)}")`);
            }
            button.set_style({ "background-image": backgrounds.join(", ") });

            return button;
        };

        let i = 0;
        for (const [value, tooltip, data, key = null, classes = []] of entries) {
            const option = create_option(value, tooltip, data);
            option.class_list.add(...classes);
            if (key !== null) {
                ui.shortcuts.add([{ key }], () => {
                    const is_focused = options_list.class_list.contains("focused");
                    if (!option.element.disabled) {
                        if (!options_list.class_list.contains("kbd-requires-focus") || is_focused) {
                            // When the list is focused, we allow the user to choose checked
                            // options for convenience. Obviously this should have no effect in
                            // terms of triggering that option, but may progress a selection.
                            // We leave it to the caller to distinguish between these cases using
                            // `event.idempotent`.
                            if (!option.element.checked || is_focused) {
                                const event = new Event("change");
                                // Trigger history changes even though it wasn't initiated by a user
                                // click.
                                event.triggered_by_shortcut = true;
                                event.idempotent = option.element.checked;
                                option.element.checked = true;
                                option.dispatch(event);
                                Shortcuts.flash(option);
                                // Prevent other elements from being triggered by the same key
                                // press.
                                return true;
                            }
                        }
                    }
                    return false;
                });
                // JavaScript's scoping is messed up.
                delay(((i) => (() => {
                    if (option.class_list.contains("hidden")) {
                        // Currently only one option is hidden: that for the inverse corner style.
                        // It uses the same keyboard shortcut as the default corner style, so we
                        // don't need to display a shortcut for it.
                        return;
                    }

                    const left = options_list.class_list.contains("vertical")
                        ? ((i % 2 === 0 && classes.includes("short"))
                            ? option.element.offsetWidth : 0)
                        : option.element.offsetLeft;
                    options_list.add(new DOM.Element("kbd", { class: "hint button" }, {
                        left: `${left}px`,
                        top: `${option.element.offsetTop}px`,
                    }).add(Shortcuts.name([{ key }])));
                }))(i));
            }
            ++i;
        }

        options_list.query_selector(`input[name="${name}"]`).element.checked = true;

        wrapper.add(options_list);

        return options_list;
    }

    /// Render the TeX contained in the label of a cell.
    render_tex(ui, cell) {
        const label = cell.element.query_selector(".label");
        if (label === null) {
            // The label will be null if the edge is invalid, which may happen when bad tikz-cd has
            // been parsed.
            return;
        }

        const update_label_transformation = () => {
            if (cell.is_edge()) {
                // Resize the bounding box for the label.
                // In Firefox, the bounding rectangle for the KaTeX element seems to be sporadically
                // available, unless we render the arrow *beforehand*.
                cell.render(ui);
                const bounding_rect = label.query_selector(".katex, .katex-error").bounding_rect();
                // The bounding rect is the size on-screen, which will hence be smaller if we are
                // zoomed out (and conversely if we are zoomed in). We therefore have to adjust the
                // dimensions (inversely) by the scaling factor.
                const scale = 2 ** -ui.scale;
                cell.arrow.label.size = new Dimensions(
                    bounding_rect.width * scale
                        + (bounding_rect.width > 0 ? CONSTANTS.EDGE_LABEL_PADDING * 2 : 0),
                    bounding_rect.height * scale
                        + (bounding_rect.height > 0 ? CONSTANTS.EDGE_LABEL_PADDING * 2 : 0),
                );
                // Rerender the edge with the new label.
                cell.render(ui);
            } else {
                cell.resize_content(ui, ui.resize_label(cell, label.element));

                // 1-cells take account of the dimensions of the cell label to be drawn snugly,
                // so if the label is resized, the edges need to be redrawn.
                for (const edge of ui.quiver.transitive_dependencies([cell], true)) {
                    edge.render(ui);
                }

                // If the cell is empty, we highlight it to make it easier to spot.
                cell.element.class_list.toggle("empty", cell.label.trim() === "");
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
                    trust: (context) => ["\\href", "\\url", "\\includegraphics"]
                        .includes(context.command),
                },
            );
            // KaTeX loads fonts as it needs them. After we call `render`, it will load the fonts it
            // needs if they haven't already been loaded, then render the LaTeX asynchronously. If
            // we calculate the label size immediately and the necessary fonts have not been loaded,
            // the calculated dimensions will be incorrect. Therefore, we need to wait until all
            // the fonts used in the document (i.e. the KaTeX-specific ones, which are the only
            // ones that may not have been loaded yet) have been loaded.
            document.fonts.ready.then(update_label_transformation);
        });
    };

    /// Update the panel state (i.e. enable/disable fields as relevant).
    update(ui) {
        const label_alignments = this.element.query_selector_all('input[name="label_alignment"]');

        // Multiple selection is always permitted, so the following code must provide sensible
        // behaviour for both single and multiple selections (including empty selections).
        const selection_contains_edge = ui.selection_contains_edge();

        // Some elements of the panel are visible only when non-loop edges, or loop edges are
        // selected. If we haven't selected any edges (e.g. if we've just deselected everything by
        // clicking on the canvas, but haven't yet released the pointer), then we keep the state as
        // it is to avoid any un-aesthetic size changes while the panel disappears.
        if (selection_contains_edge) {
            const selection_contains_nonloop = Array.from(ui.selection).some((cell) => {
                return cell.is_edge() && !cell.is_loop();
            });
            const selection_contains_loop = Array.from(ui.selection).some((cell) => cell.is_loop());
            // Disable transitions, so that slider thumbs do not appear to move when the are
            // revealed.
            if ((selection_contains_nonloop && !this.element.class_list.contains("nonloop"))
                || (selection_contains_loop && !this.element.class_list.contains("loop"))) {
                this.element.class_list.add("no-transition");
                delay(() => this.element.class_list.remove("no-transition"));
            }
            this.element.class_list.toggle("nonloop", selection_contains_nonloop);
            this.element.class_list.toggle("loop", selection_contains_loop);
        }

        // Modifying cells is not permitted when the export pane is visible.
        if (this.port === null) {
            // Default options (for when no edges/cells are selected). We only need to provide
            // defaults for inputs that display their state even when disabled.
            if (!selection_contains_edge) {
                this.label_input.element.value = "";
                this.element.query_selector(".colour-indicator").set_style({
                    background: Colour.black().css(),
                });
                for (const [property, slider] of this.sliders) {
                    let values = [0];
                    switch (property) {
                        case "label_position":
                            values = [50];
                            break;
                        case "length":
                            values = [0, 100];
                            break;
                        case "level":
                            values = [1];
                            break;
                    }
                    slider.thumbs.forEach((thumb, i) => {
                        thumb.set_value(values[i]);
                    });
                }
                if (ui.selection.size === 0) {
                    ui.element.query_selector(".label-input-container .colour-indicator")
                        .set_style({
                            background: Colour.black().css(),
                        });
                    ui.colour_picker.close();
                }
            }

            // Enable all the inputs iff we've selected at least one edge.
            this.element.query_selector_all('input:not([type="text"]), button')
                .forEach((input) => input.element.disabled = !selection_contains_edge);
            this.element.query_selector_all(".slider, .colour-indicator").forEach((element) => {
                element.class_list.toggle("disabled", !selection_contains_edge);
            });
            ui.element.query_selector(".label-input-container .colour-indicator")
                .class_list.toggle("disabled", ui.selection.size === 0);

            // Enable the label input if at least one cell has been selected.
            this.label_input.element.disabled = ui.selection.size === 0;
            if (this.label_input.element.disabled
                    && document.activeElement === this.label_input.element
            ) {
                // In Firefox, if the active element is disabled, then key
                // presses aren't registered, so we need to blur it manually.
                this.label_input.element.blur();
            }

            // A map from option names to values. If a value is `null`, that means that
            // there are multiple potential values, so we (in the case of radio buttons)
            // uncheck all such inputs or set them to an empty string (in the case of text
            // inputs).
            const values = new Map();
            let all_edges_are_arrows = selection_contains_edge;

            const consider = (name, value) => {
                const values_equal = (a, b) => {
                    if (typeof a === "object" && typeof b === "object") {
                        // This is good enough for our purposes. So far, the only object value is
                        // that for `length`.
                        return JSON.stringify(a) === JSON.stringify(b);
                    } else {
                        return a === b;
                    }
                }
                if (values.has(name) && !values_equal(values.get(name), value)) {
                    values.set(name, null);
                } else {
                    values.set(name, value);
                }
            };

            let [corners, inverse_corners] = [0, 0];

            // Collect the consistent and varying input values.
            for (const cell of ui.selection) {
                // Options applying to all cells. Technically, these are no longer under the
                // jurisdiction of `Panel` (though they were at one point). However, since we want
                // to use the same logic for these options as edge-specific options, it's convenient
                // to include them here.
                consider("{label}", cell.label);
                consider("{label_colour}", cell.label_colour);

                // Edge-specific options.
                if (cell.is_edge()) {
                    consider("label_alignment", cell.options.label_alignment);
                    // The label alignment buttons are rotated to reflect the direction of the arrow
                    // when all arrows have the same direction (at least to the nearest multiple of
                    // 90°). Otherwise, rotation defaults to 0°.
                    consider("{edge_angle}", cell.angle());
                    consider("{label_position}", cell.options.label_position);
                    consider("{offset}", cell.options.offset);
                    if (!cell.is_loop()) {
                        consider("{curve}", cell.options.curve);
                    }
                    if (cell.is_loop()) {
                        consider("{radius}", cell.options.radius);
                        consider("{angle}", cell.options.angle);
                    }
                    consider("{length}", cell.options.shorten);
                    consider("{level}", cell.options.level);
                    consider("edge-type", cell.options.style.name);
                    consider("{colour}", cell.options.colour);

                    // Arrow-specific options.
                    if (cell.options.style.name === "arrow") {
                        for (const component of ["tail", "body", "head"]) {
                            let value;
                            // The following makes the assumption that the distinguished names
                            // `cell`, `hook` and `harpoon` are unique, even between different
                            // components.
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
                        if (cell.options.style.name === "corner") {
                            ++corners;
                        }
                        if (cell.options.style.name === "corner-inverse") {
                            ++inverse_corners;
                        }
                    }
                }
            }

            const get_input = (name, value) => {
                return this.element.query_selector(`input[name="${name}"][value="${value}"]`);
            };

            // Fill the consistent values for the inputs, checking and unchecking
            // radio buttons as relevant.
            for (const [name, value] of values) {
                const property = name.slice(1, -1);
                switch (name) {
                    case "{label}":
                        if (value === null || this.label_input.element.value !== value) {
                            // Most browsers handle resetting an input value with the same value
                            // nicely. However, Safari will reset the caret to the end of the input,
                            // so we need to guard on the value actually changing.
                            this.label_input.element.value = value !== null ? value : "";
                        }
                        break;
                    case "{label_colour}":
                        // Default to black.
                        this.label_colour = value || Colour.black();
                        // If we're currently picking a colour, then changing the selection should
                        // update the colour picker value; otherwise, we just update the colour
                        // indicator in the panel.
                        if (ui.colour_picker.is_targeting(ColourPicker.TARGET.Label)) {
                            ui.colour_picker.set_colour(ui, this.label_colour);
                        } else {
                            ui.element.query_selector(".label-input-container .colour-indicator")
                                .set_style({
                                    background: this.label_colour.css(),
                                });
                        }
                        break;
                    case "{edge_angle}":
                        const angle = value !== null ? value : 0;
                        for (const option of label_alignments) {
                            option.set_style({
                                transform: `rotate(${Math.round(2 * angle / Math.PI) * 90}deg)`
                            });
                        }
                        break;
                    case "{label_position}":
                        this.sliders.get(property).thumbs[0].set_value(value !== null ? value : 50);
                        break;
                    case "{offset}":
                    case "{curve}":
                    case "{radius}":
                    case "{angle}":
                    case "{level}":
                        this.sliders.get(property).thumbs[0].set_value(value !== null ? value : 0);
                        break;
                    case "{length}":
                        const thumbs = this.sliders.get("length").thumbs;
                        thumbs[0].set_value(value !== null ? value.source : 0);
                        thumbs[1].set_value(value !== null ? 100 - value.target : 100);
                        break;
                    case "{colour}":
                        // This case is analagous to `"{label_colour}"` above.
                        // Default to black.
                        this.colour = value || Colour.black();
                        // If we're currently picking a colour, then changing the selection should
                        // update the colour picker value; otherwise, we just update the colour
                        // indicator in the panel.
                        if (ui.colour_picker.is_targeting(ColourPicker.TARGET.Edge)) {
                            ui.colour_picker.set_colour(ui, this.colour);
                        } else {
                            this.element.query_selector(".colour-indicator").set_style({
                                background: this.colour.css(),
                            });
                        }
                        break;
                    default:
                        this.element.query_selector_all(
                            `input[name="${name}"]:checked`
                        ).forEach((input) => input.element.checked = false);
                        // If there are multiple selected values, we don't check any input.
                        if (value !== null) {
                            // Check any input for which there is a canonical choice of value.
                            const selected_input = get_input(name, value);
                            // `selected_input` will never be `null`, unless we have loaded a
                            // diagram with an option we do not support in the current version of
                            // quiver. This ought not to happen in practice, as users will typically
                            // be using the latest version of quiver.
                            if (selected_input !== null) {
                                selected_input.element.checked = true;
                            }
                        }
                        break;
                }
            }

            // If the arrow edge type isn't selected, we select the (disabled) default tail, body,
            // and head styles. This means that when the arrow edge type option is selected, the
            // default arrow style will be selected, rather than whatever was last selected by the
            // user.
            if (!get_input("edge-type", "arrow").element.checked) {
                get_input("tail-type", "none").element.checked = true;
                get_input("body-type", "solid").element.checked = true;
                get_input("head-type", "arrowhead").element.checked = true;
            }

            // Display the relevant pullback/pushout button.
            const corner_button = this.element
                .query_selector(`input[name="edge-type"][value="corner"]`);
            const corner_inverse_button = this.element
                .query_selector(`input[name="edge-type"][value="corner-inverse"]`);
            let [reveal, hide] = [corner_button, corner_inverse_button];
            if (
                inverse_corners > corners
                    || inverse_corners >= corners
                        // Pick the user's preference if there isn't a clear choice.
                        && ui.settings.get("diagram.var_corner")
            ) {
                [reveal, hide] = [corner_inverse_button, corner_button];
            }
            reveal.class_list.remove("hidden");
            hide.class_list.add("hidden");
            reveal.element.disabled = false;
            // When we press `P` when neither corner style is selected, we want to select the
            // style that is currently visible. However, both have event listeners and so the
            // default style will take priority, unless we disable it initially. It is only
            // disabled while neither style is selected (because the hidden inputs must
            // receive keyboard events to toggle between the two styles).
            hide.element.disabled = !reveal.element.checked;

            // Enable/disable the arrow style buttons.
            for (const input of this.element.query_selector_all(".arrow-style input")) {
                input.element.disabled = !all_edges_are_arrows;
            }
            // Enable/disable the the curve, length, and level sliders.
            for (const slider of this.element.query_selector_all(".arrow-style .slider")) {
                slider.class_list.toggle("disabled", !all_edges_are_arrows);
            }

            // Show/hide the endpoint positioning source/target checkboxes.
            // For now, the only cells whose shapes are not points are vertices. So we only need to
            // display this option for arrows that point to arrows that have a vertex as their
            // source or target.
            let ep_source_checked = null, ep_target_checked = null;
            for (const cell of ui.selection) {
                if (cell.is_edge()) {
                    if (cell.source.is_edge()
                        && (cell.source.source.is_vertex() || cell.source.target.is_vertex())) {
                        if (ep_source_checked === null) {
                            ep_source_checked = true;
                        }
                        ep_source_checked = ep_source_checked &&
                            cell.options.edge_alignment.source;
                    }
                    if (cell.target.is_edge()
                        && (cell.target.source.is_vertex() || cell.target.target.is_vertex())) {
                        if (ep_target_checked === null) {
                            ep_target_checked = true;
                        }
                        ep_target_checked = ep_target_checked &&
                            cell.options.edge_alignment.target;
                    }
                }
            }
            const endpoint_positioning = this.element.query_selector("#endpoint-positioning");
            endpoint_positioning.class_list.toggle("hidden",
                ep_source_checked === null && ep_target_checked === null);
            const ep_source = endpoint_positioning.query_selector('label:first-of-type');
            ep_source.class_list.toggle("hidden", ep_source_checked === null);
            ep_source.query_selector('input[type="checkbox"]').element.checked = ep_source_checked;
            const ep_target = endpoint_positioning.query_selector('label:last-of-type');
            ep_target.class_list.toggle("hidden", ep_target_checked === null);
            ep_target.query_selector('input[type="checkbox"]').element.checked = ep_target_checked;

            // Enable all inputs in the global section of the panel.
            this.global.query_selector_all(`input[type="text"]`).forEach((input) => {
                input.element.disabled = false;
            });
        } else {
            // Disable all the inputs.
            this.element.query_selector_all("input, button")
                .forEach((input) => input.element.disabled = true);
            // Disable the macro input.
            this.global.query_selector_all('input[type="text"]')
                .forEach((input) => input.element.disabled = true);
        }

        // The panel size is not fixed, since we hide some options depending on the edge (e.g. the
        // edge alignment checkboxes), so we need to resize the panel after updating it.
        this.update_position();
    }

    /// Hide the panel off-screen.
    hide(ui) {
        if (ui.colour_picker.is_targeting(ColourPicker.TARGET.Edge)) {
            ui.colour_picker.close();
        }
        this.element.class_list.add("hidden");
        this.defocus_inputs();
    }

    /// Hide the panel and label input if no relevant cells are selected.
    hide_if_unselected(ui) {
        if (!ui.selection_contains_edge()) {
            this.hide(ui);
        }
        if (ui.selection.size === 0) {
            this.label_input.parent.class_list.add("hidden");
            ui.colour_picker.close();
        }
    }

    /// Focuses and selects all the text in the label input.
    focus_label_input() {
        const input = this.label_input.element;
        input.focus();
        input.setSelectionRange(0, input.value.length);
    }

    /// Defocuses any elements that have been focused via the keyboard.
    defocus_inputs() {
        for (const element of this.element.query_selector_all(".focused")) {
            element.class_list.remove("focused");
        }
        const next_to_focus = this.element.query_selector(".next-to-focus");
        if (next_to_focus !== null) {
            next_to_focus.class_list.remove("next-to-focus");
        }
        this.element.query_selector(".kbd-requires-focus").class_list.add("next-to-focus");
    }

    /// Unqueue any selected cell, typically after a user action affecting the cells in the
    /// selection.
    unqueue_selected(ui) {
        for (const element of ui.element.query_selector_all(".cell.selected kbd.queue")) {
            element.class_list.remove("queue");
        }
    }

    /// Centre the panel vertically.
    update_position() {
        const panel_height
            = this.element.query_selector(".wrapper").bounding_rect().height;
        const document_height = document.body.offsetHeight;
        const top_offset = Math.max(document_height - panel_height - 16 * 2, 0) / 2;
        this.element.set_style({
            "margin-top": `${top_offset}px`,
            // The bottom margin is not required for correct spacing, but is required so that the
            // bottom area does not capture pointer events.
            "margin-bottom": `${top_offset}px`,
        });
    }

    /// Dismiss the import/export pane, if it is shown.
    dismiss_port_pane(ui) {
        if (this.port !== null) {
            ui.element.query_selector(".port").remove();
            for (const id of this.port.shortcuts) {
                ui.shortcuts.remove(id);
            }
            this.port = null;
            ui.switch_mode(UIMode.default);
            this.update(ui);
            return true;
        }
        return false;
    }

    /// Adjust the value of any selected sliders.
    modify_sliders(delta) {
        let any_focused = false;
        for (const slider of this.sliders.values()) {
            if (slider.class_list.contains("focused")) {
                const thumb = slider.thumbs.find((thumb) => thumb.class_list.contains("focused"));
                thumb.set_value(thumb.value + slider.step * delta, true);
                if (slider.class_list.contains("symmetric")) {
                    thumb.symmetrise();
                }
                any_focused = true;
            }
        }
        return any_focused;
    }
}

/// The handler for keyboard shortcuts. This handles just the control flow, and not the physical
/// buttons triggering any shortcuts.
class Shortcuts {
    constructor(ui) {
        // A map from keys to the shortcuts to which they correspond.
        this.shortcuts = new Map();

        // An identifier for shortcuts, used to allow the caller to delete shortcuts.
        this.next_id = 0;

        // Handle global key presses (such as, but not exclusively limited to, keyboard shortcuts).
        const handle_shortcut = (type, event) => {
            // Ignore everything in embedded mode.
            if (ui.in_mode(UIMode.Embedded)) {
                return;
            }

            // Many keyboard shortcuts are only relevant when we're not midway
            // through typing in an input, which should capture key presses.
            const editing_input = ui.input_is_active();

            // On Mac OS X, holding the Command key seems to override the usual capitalisation
            // modifier that holding Shift does. This is inconsistent with other operating systems,
            // so we override it manually here.
            const key = event.key.toLowerCase();

            if (this.shortcuts.has(key)) {
                for (const shortcut of this.shortcuts.get(key)) {
                    if (
                        (shortcut.shift === null || event.shiftKey === shortcut.shift
                            || (key === "shift" && event.shiftKey === (type === "keydown")))
                            && (shortcut.modifier === null
                                || (event.metaKey
                                    || (event.ctrlKey && !Shortcuts.is_Apple_platform()))
                                        === shortcut.modifier
                                || ["control", "meta"].includes(key))
                    ) {
                        const effect = () => {
                            let prevent_others = false;
                            // Trigger the shortcut effect.
                            const action = shortcut[{ keydown: "action", keyup: "unaction" }[type]];
                            if (action !== null) {
                                // Only trigger the action if the associated button is not
                                // disabled.
                                if (shortcut.button === null || !shortcut.button.element.disabled) {
                                    prevent_others = action(event);
                                }
                                if (shortcut.button !== null) {
                                    // The button might be disabled by `action`, but we still want
                                    // to trigger the visual indication if it was enabled when
                                    // activated.
                                    if (!shortcut.button.element.disabled) {
                                        // Give some visual indication that the action has
                                        // been triggered.
                                        Shortcuts.flash(shortcut.button);
                                    }
                                }
                            }
                            return prevent_others;
                        };

                        if (!editing_input && !ui.in_mode(UIMode.Modal)
                            || shortcut.context === Shortcuts.SHORTCUT_PRIORITY.Always)
                        {
                            event.preventDefault();
                            if (effect()) {
                                break;
                            }
                        } else if (!ui.in_mode(UIMode.Modal) && type === "keydown") {
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
                                    if (shortcut.context === Shortcuts.SHORTCUT_PRIORITY.Defer) {
                                        effect();
                                    } else {
                                        // Give some visual indication that the input stole the
                                        // keyboard focus.
                                        Shortcuts.flash(new DOM.Element(input));
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

    // Associate an action to a keyboard shortcut. Multiple shortcuts can be associated to a single
    // action, making it easier to facilitate different keyboard layouts.
    add(combinations, action, button = null, unaction = null) {
        for (const shortcut of combinations) {
            // We prefer to be case-insensitive due to differences in OS behaviour (see comment
            // above).
            const key = shortcut.key.toLowerCase();
            if (!this.shortcuts.has(key)) {
                this.shortcuts.set(key, []);
            }
            this.shortcuts.get(key).push({
                id: this.next_id,
                // `null` means we don't care about whether the modifier key
                // is pressed or not, so we need to special case it.
                modifier: shortcut.modifier !== null ? (shortcut.modifier || false) : null,
                shift: shortcut.shift !== null ? (shortcut.shift || false) : null,
                // The function to call when the shortcut is triggered.
                action,
                // The function to call (if any) when the shortcut is released.
                unaction,
                context: shortcut.context || Shortcuts.SHORTCUT_PRIORITY.Conservative,
                button,
            });
        }
        return this.next_id++;
    }

    // Remove all actions associated to a shortcut ID.
    remove(id) {
        for (const [key, shortcuts] of this.shortcuts) {
            this.shortcuts.set(key, shortcuts.filter((shortcut) => shortcut.id !== id));
        }
    }

    /// Returns whether this is likely to be an Apple platform or not, which determines what style
    /// of keyboard shortcut we will display.
    static is_Apple_platform() {
        return /^(Mac|iPhone|iPod|iPad)/.test(navigator.platform);
    }

    /// Returns the names of each of the keys involved in the key combinations. This is not intended
    /// to be called directly, but instead by `name` and `element`.
    static components(combinations) {
        // By default, we display "Ctrl" and "Shift" as modifier keys, as most
        // operating systems use this to initiate keyboard shortcuts. For Mac
        // and iOS, we switch to displaying "⌘" and "⇧". However, both keys
        // (on any operating system) work with the shortcuts: this is simply
        // used to work out what to display.
        const is_Apple_platform = Shortcuts.is_Apple_platform();

        const shortcuts_keys = [];
        for (const shortcut of combinations) {
            // Format the keyboard shortcut to make it discoverable in the toolbar.
            let key = shortcut.key;
            if (/^[a-z]$/.test(key)) {
                // Upper case any letter key.
                key = key.toUpperCase();
            }
            const symbols = {
                Backspace: "⌫",
                Tab: "⇥",
                Enter: "↵",
                Shift: "⇧",
                Escape: "esc",
                " ": "        ",
                ArrowLeft: "←",
                ArrowDown: "↓",
                ArrowRight: "→",
                ArrowUp: "↑",
                Delete: "del",
                Control: "ctrl",
                Alt: "alt",
            };
            key = symbols[key] || key;
            const shortcut_keys = [key];
            if (shortcut.modifier) {
                shortcut_keys.unshift(is_Apple_platform ? "⌘" : "ctrl");
            }
            if (shortcut.shift) {
                shortcut_keys.unshift(is_Apple_platform ? "⇧" : "shift");
            }
            shortcuts_keys.push(shortcut_keys);
        }

        return shortcuts_keys;
    }

    /// Fills `element` with a series of `kbd` elements, representing the key combinations.
    static element(element, combinations) {
        const components = Shortcuts.components(combinations);
        for (let i = 0; i < components.length; ++i) {
            for (const key of components[i]) {
                element.add(new DOM.Element("kbd").add(key));
            }
            if (i + 1 < components.length) {
                element.add(",");
            }
        }
        return element;
    }

    /// Return the name of a keyboard shortcut, to display to the user.
    static name(combinations) {
        const components = Shortcuts.components(combinations);
        return components.map((shortcut_keys) => {
            return shortcut_keys.join(Shortcuts.is_Apple_platform() ? "" : "+");
        }).slice(0, 1).join("/");
    }

    /// Trigger a "flash" animation on an element, typically in response to its corresponding
    /// keyboard shortcut being triggered.
    static flash(button) {
        button.class_list.remove("flash");
        // Removing a class and instantly adding it again is going to be ignored by
        // the browser, so we need to trigger a reflow to get the animation to
        // retrigger.
        void button.element.offsetWidth;
        button.class_list.add("flash");
    }
}

/// Defines the contexts in which a keyboard shortcut may trigger.
Shortcuts.SHORTCUT_PRIORITY = new Enum(
    "SHORTCUT_PRIORITY",
    // Triggers whenever the keyboard shortcut is held.
    "Always",
    // Triggers when an input is not focused, or if the shortcut
    // has no effect on the input.
    "Defer",
    // Triggers when an input is not focused.
    "Conservative",
);

/// The toolbar, providing shortcuts to useful actions. This handles both the physical
/// toolbar buttons and the keyboard shortcuts.
class Toolbar {
    constructor() {
        /// The toolbar element.
        this.element = null;
    }

    initialise(ui) {
        this.element = new DOM.Div({ class: "toolbar" })
            .listen(pointer_event("down"), (event) => {
                if (event.button === 0) {
                    event.stopImmediatePropagation();
                }
            });

        const add_action = (name, combinations, action, element = this.element) => {
            const shortcut_name = Shortcuts.name(combinations);

            const button = new DOM.Element("button", { class: "action", "data-name": name })
                .add(new DOM.Element("span", { class: "symbol" }).add(
                    new DOM.Element("img", { src: `icons/${
                        name.toLowerCase().replace(/ /g, "-").replace(/\./g, "")
                    }.svg` })
                ))
                .add(new DOM.Element("span", { class: "name" }).add(name))
                .add(new DOM.Element("span", { class: "shortcut" }).add(shortcut_name))
                .listen(pointer_event("down"), (event) => {
                    if (event.button === 0) {
                        event.stopImmediatePropagation();
                    }
                })

            const trigger_action_and_update_toolbar = (event) => {
                action.call(button, event);
                ui.toolbar.update(ui);
            };

            button.listen("click", trigger_action_and_update_toolbar);

            ui.shortcuts.add(combinations, trigger_action_and_update_toolbar, button);

            element.add(button);
            return button;
        };

        const add_subtoolbar = (name) => {
            const action = add_action(name, [], () => {});
            action.class_list.add("dropdown");
            const subtoolbar = new DOM.Div({ class: "subtoolbar" });
            action.add(subtoolbar);
            return subtoolbar;
        };

        // Add all of the toolbar buttons.

        // "Saving" updates the URL to reflect the current diagram.
        add_action(
            "Save",
            [{ key: "S", modifier: true, context: Shortcuts.SHORTCUT_PRIORITY.Always }],
            () => {
                const { data } = ui.quiver.export(
                    "base64",
                    ui.settings,
                    ui.options(),
                    ui.definitions(),
                );
                // `data` is the new URL.
                history.pushState({}, "", data);
            },
        );

        add_action(
            "Undo",
            [{ key: "Z", modifier: true, context: Shortcuts.SHORTCUT_PRIORITY.Defer }],
            () => {
                ui.history.undo(ui);
            },
        );

        add_action(
            "Redo",
            [{ key: "Z", modifier: true, shift: true, context: Shortcuts.SHORTCUT_PRIORITY.Defer }],
            () => {
                ui.history.redo(ui);
            },
        );

        add_action(
            "Select all",
            [{ key: "A", modifier: true, context: Shortcuts.SHORTCUT_PRIORITY.Defer }],
            () => {
                ui.select(...ui.quiver.all_cells());
            },
        );

        add_action(
            "Deselect all",
            [{ key: "A", modifier: true, shift: true, context: Shortcuts.SHORTCUT_PRIORITY.Defer }],
            () => {
                ui.deselect();
                ui.panel.hide(ui);
                ui.panel.label_input.parent.class_list.add("hidden");
                ui.colour_picker.close();
            },
        );

        add_action(
            "Delete",
            [
                { key: "Backspace" },
                { key: "Delete" },
            ],
            () => {
                ui.history.add(ui, [{
                    kind: "delete",
                    cells: ui.quiver.transitive_dependencies(ui.selection),
                }], true);
                ui.panel.update(ui);
            },
        );

        const transform = add_subtoolbar("Transform");
        add_action(
            "Flip hor.",
            [],
            () => {
                const vertices = ui.quiver.all_cells().filter((cell) => cell.is_vertex());
                const bounding_rect = ui.quiver.bounding_rect();
                if (bounding_rect !== null) {
                    const [[x_min,], [x_max,]] = bounding_rect;
                    ui.history.add(ui, [{
                        kind: "move",
                        displacements: vertices.map((vertex) => ({
                            vertex,
                            from: vertex.position,
                            to: new Position(
                                x_min + (x_max - vertex.position.x),
                                vertex.position.y,
                            ),
                        })),
                    }, {
                        kind: "flip",
                        cells: ui.quiver.all_cells().filter((cell) => cell.is_edge()),
                    }], true);
                }
            },
            transform
        );
        add_action(
            "Flip ver.",
            [],
            () => {
                const vertices = ui.quiver.all_cells().filter((cell) => cell.is_vertex());
                const bounding_rect = ui.quiver.bounding_rect();
                if (bounding_rect !== null) {
                    const [[, y_min], [, y_max]] = bounding_rect;
                    ui.history.add(ui, [{
                        kind: "move",
                        displacements: vertices.map((vertex) => ({
                            vertex,
                            from: vertex.position,
                            to: new Position(
                                vertex.position.x,
                                y_min + (y_max - vertex.position.y),
                            ),
                        })),
                    }, {
                        kind: "flip",
                        cells: ui.quiver.all_cells().filter((cell) => cell.is_edge()),
                    }], true);
                }
            },
            transform
        );
        add_action(
            "Rotate",
            [],
            () => {
                const vertices = ui.quiver.all_cells().filter((cell) => cell.is_vertex());
                const bounding_rect = ui.quiver.bounding_rect();
                if (bounding_rect !== null) {
                    const [[x_min, y_min], [x_max,]] = bounding_rect;
                    ui.history.add(ui, [{
                        kind: "move",
                        displacements: vertices.map((vertex) => ({
                            vertex,
                            from: vertex.position,
                            to: new Position(
                                x_min + (vertex.position.y - y_min),
                                y_min - (vertex.position.x - x_max),
                            ),
                        })),
                    }], true);
                }
            },
            transform
        );

        add_action(
            "Centre view",
            [{ key: "G" }],
            () => {
                // If the focus point is focused, we centre on it; otherwise we centre on the
                // selection, or the entire quiver if no cells are selected.
                if (ui.element.query_selector(".focus-point.focused")) {
                    ui.pan_to(ui.centre_offset_from_position(ui.focus_position));
                } else {
                    ui.centre_view();
                }
            },
        );

        add_action(
            "Zoom out",
            [{ key: "-", modifier: true, context: Shortcuts.SHORTCUT_PRIORITY.Always }],
            () => {
                ui.pan_view(Offset.zero(), -0.25);
            },
        );

        add_action(
            "Zoom in",
            [{ key: "=", modifier: true, context: Shortcuts.SHORTCUT_PRIORITY.Always }],
            () => {
                ui.pan_view(Offset.zero(), 0.25);
            },
        );

        add_action(
            "Reset zoom",
            // We'd like to display the current zoom level, so we use a slight hack: we set the
            // "key" to be the zoom level: this will never be triggered by a shortcut, because there
            // is no key called "100%" or similar. However, the text will then display underneath
            // the button as desired.
            [{ key: "100%" }],
            () => {
                ui.scale = 0;
                ui.pan_view(Offset.zero());
            },
        );

        add_action(
            "Hide grid",
            [{ key: "H", modifier: false, context: Shortcuts.SHORTCUT_PRIORITY.Defer }],
            function () {
                ui.grid.class_list.toggle("hidden");
                const hidden = ui.grid.class_list.contains("hidden");
                this.query_selector(".name").replace(
                    (hidden ? "Show" : "Hide") + " grid"
                );
            },
        );

        add_action(
            "Show hints",
            [{
                key: "H", modifier: true, shift: true, context: Shortcuts.SHORTCUT_PRIORITY.Always
            }],
            function () {
                ui.element.class_list.toggle("show-hints");
                const hidden = !ui.element.class_list.contains("show-hints");
                this.query_selector(".name").replace(
                    (hidden ? "Show" : "Hide") + " hints"
                );
            },
        );

        add_action(
            "Show queue",
            [],
            function () {
                ui.element.class_list.toggle("show-queue");
                const hidden = !ui.element.class_list.contains("show-queue");
                this.query_selector(".name").replace(
                    (hidden ? "Show" : "Hide") + " queue"
                );
            },
        );

        add_action(
            "Shortcuts",
            [{
                key: "/", modifier: true, context: Shortcuts.SHORTCUT_PRIORITY.Always
            }],
            () => {
                const hidden = ui.element.query_selector("#keyboard-shortcuts-pane").class_list
                    .contains("hidden");
                ui.element.query_selector_all(".pane").forEach((pane) => {
                    pane.class_list.add("hidden");
                });
                ui.element.query_selector("#keyboard-shortcuts-pane").class_list
                    .toggle("hidden", !hidden);
                ui.element.query_selector(".version").class_list.add("hidden");
            },
        );

        add_action(
            "About",
            [],
            () => {
                const hidden = ui.element.query_selector("#about-pane").class_list
                    .contains("hidden");
                ui.element.query_selector_all(".pane").forEach((pane) => {
                    pane.class_list.add("hidden");
                });
                ui.element.query_selector("#about-pane").class_list.toggle("hidden", !hidden);
                ui.element.query_selector(".version").class_list.toggle("hidden", !hidden);
            },
        );

        // Disable those buttons that need to be disabled.
        this.update(ui);
    }

    /// Update the toolbar (e.g. enabling or disabling buttons based on UI mode).
    update(ui) {
        if (this.element === null) {
            // During initialisation, the `UI` may call `toolbar.update` when switching modes.
            // We may simply ignore this.
            return;
        }

        const enable_if = (name, condition) => {
            const element = this.element.query_selector(`.action[data-name="${name}"]`).element;
            element.disabled = !condition;
        };

        const default_pan = [UIMode.Default, UIMode.Pan];

        enable_if("Undo", ui.in_mode(UIMode.KeyMove, ...default_pan) && ui.history.present !== 0);
        enable_if("Redo", ui.in_mode(UIMode.KeyMove, ...default_pan)
            && ui.history.present < ui.history.actions.length);
        enable_if("Select all",
            ui.in_mode(...default_pan) && ui.selection.size < ui.quiver.all_cells().length);
        enable_if("Deselect all", ui.in_mode(...default_pan) && ui.selection.size > 0);
        enable_if("Delete", ui.in_mode(...default_pan) && ui.selection.size > 0);
        enable_if("Transform", ui.in_mode(...default_pan) && ui.quiver.all_cells().length > 0);
        enable_if("Centre view",
            ui.element.query_selector(".focus-point.focused")
            // Technically the first condition below is subsumed by the latter, but we keep it to
            // mirror the conditions in `centre_view`.
            || ui.selection.size > 0 || (ui.quiver.cells.length > 0 && ui.quiver.cells[0].size > 0)
        );
        enable_if("Zoom in", ui.scale < CONSTANTS.MAX_ZOOM);
        enable_if("Zoom out", ui.scale > CONSTANTS.MIN_ZOOM);
        enable_if("Reset zoom", ui.scale !== 0);

        // Update the current zoom level underneath the "Reset zoom" button.
        this.element.query_selector('.action[data-name="Reset zoom"] .shortcut').element.innerText
            = `${Math.round(2 ** ui.scale * 100)}%`;
    }
}

/// The colour wheel and colour picker.
class ColourPicker {
    constructor() {
        // The pop up colour panel, with the colour wheel and colour picker.
        this.element = null;

        // The current colour displayed by the colour wheel.
        this.colour = Colour.black();

        // Whether we are selecting a colour for a `ColourPicker.TARGET`.
        this.target = null;

        // We memoise the colour wheel images (for each lightness level), so we don't have to
        // continually recompute them. There may be more efficient ways to do this with a little
        // more thought about the HSL and RGB colour models, but this is a simple solution for now.
        this.colour_wheels = new Map();

        // The sliders, which we store in a map so we retain access to the `DOM.Multislider`
        // elements, similarly to in `Panel`.
        this.sliders = new Map();
    }

    initialise(ui) {
        this.element = new DOM.Div({ class: "colour-panel hidden" })
            .listen("wheel", (event) => event.stopImmediatePropagation(), { passive: true })
            .listen(pointer_event("down"), (event) => event.stopPropagation());

        // The colour wheel.
        const size = 192;
        const canvas = new DOM.Canvas(null, size, size, { class: "colour-wheel" })
            .add_to(this.element);
        // The colour picker, which the user can move around by clicking on the colour wheel.
        new DOM.Div({ class: "colour-picker" }).add_to(this.element);

        // Update the position of the colour picker based on a pointer `event`.
        const update_colour_picker = (event) => {
            const rect = canvas.bounding_rect();
            const [x, y] = [event.clientX - rect.left, event.clientY - rect.top];
            const radius = Math.min(Math.hypot(x - size / 2, y - size / 2), size / 2);
            const angle = Math.atan2(y - size / 2, x - size / 2) + Math.PI;
            let [h, s, l, a] = this.colour.hsla();
            [h, s] = [Math.round(rad_to_deg(angle)), Math.round(2 * radius / size * 100)];
            this.set_selection_colour(ui, new Colour(h, s, l, a));
        };

        let is_colour_picking = false;
        canvas.listen(pointer_event("down"), (event) => {
            is_colour_picking = true;
            event.stopPropagation();
            update_colour_picker(event);
        });

        document.addEventListener(pointer_event("move"), (event) => {
            if (is_colour_picking) {
                event.stopPropagation();
                // While the `active` class is present, transitions will be disabled.
                this.element.class_list.add("active");
                update_colour_picker(event);
            }
        });

        document.addEventListener(pointer_event("up"), (event) => {
            if (is_colour_picking) {
                event.stopPropagation();
                is_colour_picking = false;
                this.element.class_list.remove("active");
            }
        });

        // The lightness slider.
        const wrapper = new DOM.Div({ class: "wrapper" }).add_to(this.element);
        const slider = new DOM.Multislider("Lightness", 0, 100, 1).listen("input", () => {
            const [h, s, /* l */, a] = this.colour.hsla();
            this.element.class_list.add("active");
            this.set_selection_colour(ui, new Colour(h, s, parseInt(slider.values()), a));
            delay(() => this.element.class_list.remove("active"));
        });
        this.sliders.set("lightness", slider);
        slider.label.set_attributes({ title: "Lightness" }).add_to(wrapper);

        // The checkbox allowing the label and edge colours to remain in sync.
        new DOM.Element("label")
            .add("Sync label/edge colours:")
            .add(new DOM.Element("input", { type: "checkbox", checked: "" })
                .listen("change", (_, element) => {
                    if (element.checked) {
                        // If there are any selected edges whose label colour does not match their
                        // edge colour, make them the same.
                        if (Array.from(ui.selection).some((cell) => {
                            return cell.is_edge() && !cell.label_colour.eq(cell.options.colour);
                        })) {
                            // This isn't idempotent, because now the checkbox is checked and so
                            // both labels and edges will be updated.
                            this.set_selection_colour(ui, this.colour);
                        }
                    }
                })
            ).add_to(wrapper);

        // The colour palette.
        const palette = new DOM.Div({ class: "palette" }).add_to(wrapper);

        // Add each of the palette colour groups.
        const groups = [{
            name: "Preset",
            colours: [
                Colour.black(),
                new Colour(0, 60, 60),
                new Colour(30, 60, 60),
                new Colour(60, 60, 60),
                new Colour(120, 60, 60),
                new Colour(180, 60, 60),
                new Colour(240, 60, 60),
                new Colour(270, 60, 60),
                new Colour(300, 60, 60),
                new Colour(0, 0, 100)
            ]
        }, {
            name: "LaTeX",
            colours: [],
        }, {
            name: "Diagram",
            colours: [],
        }];
        for (const { name, colours } of groups) {
            const group = new DOM.Element("label", {
                "data-group": name,
            }).add(`${name}:`).add_to(palette);
            this.set_colours_in_palette_group(ui, group, colours);
        }
    }

    /// Open the colour picker with a specified `target` if the colour picker is hidden; change it
    /// its target if it does not match `target` but is currently open; or close it otherwise.
    open_or_close(ui, target) {
        if (!this.element.class_list.contains("hidden") && this.target === target) {
            this.close();
            return;
        }

        this.target = target;
        this.element.class_list.add("active");
        this.element.class_list.remove("target-label", "target-edge");
        switch (this.target) {
            case ColourPicker.TARGET.Label:
                this.element.class_list.add("target-label");
                break;
            case ColourPicker.TARGET.Edge:
                this.element.class_list.add("target-edge");
                break;
        }
        if (this.element.class_list.contains("hidden")) {
            // If every edge colour matches the label colour, we check the "Sync label/edge colours"
            // button; otherwise, we uncheck it. We only do this if we're opening the colour picker,
            // rather than switching between the label/edge targets, as it's confusing for the
            // checkbox state to change in that case.
            this.element.query_selector('input[type="checkbox"]').element.checked =
                Array.from(ui.selection).every((cell) => {
                    return cell.is_vertex() || cell.label_colour.eq(cell.options.colour);
                });
        }
        this.element.class_list.remove("hidden");
        this.element.element.scrollTop = 0;
        delay(() => this.element.class_list.remove("active"));
    }

    /// Close the colour picker.
    close() {
        this.element.class_list.add("hidden");
        this.target = null;
    }

    /// Sets the colour of the selected labels or edges to the given colour.
    set_selection_colour(ui, colour) {
        // Whether to sync setting label and edge colour.
        const sync_targets = this.element.query_selector('input[type="checkbox"]').element.checked;

        const label_colour_change = {
            kind: "label_colour",
            value: colour,
            cells: Array.from(ui.selection).map((cell) => ({
                cell,
                from: cell.label_colour,
                to: colour,
            })),
        };
        const colour_change = {
            kind: "colour",
            value: colour,
            cells: Array.from(ui.selection).filter(cell => cell.is_edge())
                .map((edge) => ({
                    edge,
                    from: edge.options.colour,
                    to: colour,
                })),
        };

        let changes;
        switch (this.target) {
            case ColourPicker.TARGET.Label:
                changes = [label_colour_change];
                if (sync_targets) {
                    changes.push(colour_change);
                }
                ui.history.add_or_modify_previous(
                    ui,
                    // `this.colour === colour` only when we have just clicked the checkbox to make
                    // the label and edge colours the same.
                    ["label_colour", ui.selection, sync_targets, this.colour === colour],
                    changes,
                );
                break;
            case ColourPicker.TARGET.Edge:
                changes = [colour_change];
                if (sync_targets) {
                    changes.push(label_colour_change);
                }
                ui.history.add_or_modify_previous(
                    ui,
                    ["colour", ui.selection, sync_targets, this.colour === colour],
                    changes,
                );
                break;
        }
    }

    /// Set the colour of the colour picker to a given colour.
    set_colour(ui, colour) {
        this.colour = colour;
        // Alpha is currently not in use.
        const [hue, saturation, lightness, /* alpha */] = colour.hsla();

        const canvas = new DOM.Canvas(this.element.query_selector(".colour-wheel"));
        const context = canvas.context;
        const { width, height } = canvas.element;

        // If we have not previously, we need to render the colour wheel with the given lightness.
        if (!this.colour_wheels.has(lightness)) {
            const image = context.createImageData(width, height);
            const data = image.data;
            for (let x = 0; x < width; ++x) {
                for (let y = 0; y < height; ++y) {
                    const i = x + y * width;
                    const radius = Math.hypot(x - width / 2, y - height / 2);
                    const angle = Math.atan2(y - height / 2, x - width / 2) + Math.PI;
                    // We're assuming that `width` = `height`.
                    const [r, g, b, /* a */] = new Colour(
                        rad_to_deg(angle),
                        Math.min(1, 2 * radius / width) * 100,
                        lightness,
                        1
                    ).rgba();
                    const j = 4 * i;
                    [data[j], data[j + 1], data[j + 2], data[j + 3]] = [r, g, b, 255];
                }
            }
            this.colour_wheels.set(lightness, image);
        }
        // Update the colour wheel.
        context.putImageData(this.colour_wheels.get(lightness), 0, 0);

        const angle = deg_to_rad(hue);
        const size = width / window.devicePixelRatio / 2;
        const radius = saturation / 100 * size;
        const picker = this.element.query_selector(".colour-picker");
        picker.set_style({
            left: `${canvas.element.offsetLeft - Math.cos(angle) * radius}px`,
            top: `${canvas.element.offsetTop + size - Math.sin(angle) * radius}px`,
            background: colour.css(),
            "border-color": lightness >= 50 ? "var(--ui-black)" : "var(--ui-white)",
        });
        this.sliders.get("lightness").thumbs[0].set_value(lightness);
        switch (this.target) {
            case ColourPicker.TARGET.Label:
                ui.panel.label_colour = colour;
                ui.element.query_selector(".label-input-container .colour-indicator").set_style({
                    background: colour.css(),
                });
                break;
            case ColourPicker.TARGET.Edge:
                ui.panel.colour = colour;
                ui.panel.element.query_selector(".colour-indicator").set_style({
                    background: colour.css(),
                });
                break;
        }
    }

    is_targeting(target) {
        return !this.element.class_list.contains("hidden") && this.target === target;
    }

    set_colours_in_palette_group(ui, group, colours) {
        // Remove any existing colours.
        group.query_selector_all(".empty, .colour").forEach((element) => element.remove());

        // Explicitly state if there are no colours in the group.
        if (colours.length === 0) {
            group.add(new DOM.Element("span", { class: "empty" }).add("(None)"));
        }
        // Add colour swatches to the group that may be clicked to set the current colour.
        for (const colour of colours) {
            new DOM.Div({ class: "colour", title: colour.name }, {
                background: colour.css(),
            }).listen("click", () => {
                this.set_selection_colour(ui, colour);
            }).add_to(group);
        }
    }

    /// Update the LaTeX colour palette group from `UI.colours`.
    update_latex_colours(ui) {
        const group = this.element.query_selector(`label[data-group="LaTeX"]`);
        this.set_colours_in_palette_group(ui, group, Array.from(ui.colours.values()));
    }

    /// Update the diagram colour palette group.
    update_diagram_colours(ui) {
        // Rather than keep track of the current colours in the diagram, which would be most
        // efficient, but also involve a fair deal of book-keeping, we instead simply iterate
        // through all the cells and collect their colours every time that the diagram changes (i.e.
        // whenever a cell is added or removed, or a colour is changed). Even for large diagrams,
        // this ought to be fast.
        const colours = new Set();
        for (const cell of ui.quiver.all_cells()) {
            colours.add(`${cell.label_colour}`);
            if (cell.is_edge()) {
                colours.add(`${cell.options.colour}`);
            }
        }
        const group = this.element.query_selector(`label[data-group="Diagram"]`);
        this.set_colours_in_palette_group(ui, group, Array.from(colours).map((string) => {
            const [h, s, l, a] = string.split(",");
            return new Colour(parseInt(h), parseInt(s), parseInt(l), parseFloat(a));
        }));
    }
}

/// What property is the focus of the colour picker.
ColourPicker.TARGET = new Enum(
    "TARGET",
    // The cell label.
    "Label",
    // The edge label.
    "Edge",
);

/// An k-cell (such as a vertex or edge). This object represents both the
/// abstract properties of the cell as well as their HTML representation.
class Cell {
    constructor(quiver, level, label = "", label_colour = Colour.black()) {
        // The k for which this cell is an k-cell.
        this.level = level;

        // The label with which the vertex or edge is annotated.
        this.label = label;

        // The colour of the label (hue, saturation, lightness, alpha).
        this.label_colour = label_colour;

        // An ID used to allow the user to jump to this cell via the keyboard.
        this.code = "";
        const chars = "ASDFJKLGHEIRUCM".split("");
        for (let value = Cell.NEXT_ID++; value >= 0; value = Math.floor(value / chars.length) - 1) {
            this.code = chars[value % chars.length] + this.code;
        }

        // Add this cell to the quiver.
        quiver.add(this);

        // Elements are specialised depending on whether the cell is a vertex (0-cell) or edge.
        this.element = null;
    }

    /// Set up the cell's element with interaction events.
    initialise(ui) {
        this.element.class_list.add("cell");

        const content_element = this.content_element;

        // Set the label colour.
        if (this.label_colour.is_not_black()) {
            this.element.query_selector(".label").set_style({
                color: this.label_colour.css(),
            });
        }

        // For cells with a separate `content_element`, we allow the cell to be moved
        // by dragging its `element` (under the assumption it doesn't totally overlap
        // its `content_element`). For now, these are precisely the vertices.
        // We allow vertices to be moved by dragging its `element` (which contains its
        // `content_element`, the element with the actual cell content).
        if (this.is_vertex()) {
            this.element.listen(pointer_event("down"), (event) => {
                if (event.button === 0) {
                    if (ui.in_mode(UIMode.Default)) {
                        event.stopPropagation();
                        ui.dismiss_pane();
                        ui.focus_point.class_list.remove(
                            "revealed", "pending", "active", "focused", "smooth"
                        );
                        const vertices = Array.from(ui.selection).filter((cell) => cell.is_vertex());
                        // If the cell we're dragging is part of the existing selection,
                        // then we'll move every cell that is selected. However, if it's
                        // not already part of the selection, we'll just drag this cell
                        // and ignore the selection.
                        const move = new Set(ui.selection.has(this) ? vertices : [this]);
                        ui.switch_mode(
                            new UIMode.PointerMove(
                                ui,
                                ui.position_from_event(event),
                                move,
                            ),
                        );
                    }
                }
            });
        } else {
            // Vertices have custom handling for adding `kbd`, but it's more convenient to handle
            // edges here.
            // The identifier that notifies the user how to jump to this cell.
            ui.codes.set(this.code, this);
            this.element.add(new DOM.Element("kbd", {
                "data-code": this.code,
                class: "hint queue",
            }));
        }

        // We record whether a cell was already selected when we click on it, because
        // we only want to trigger a label input focus if we click on a cell that is
        // already selected. Clicking on an unselected cell should not focus the input,
        // or we wouldn't be able to immediately delete a cell with Backspace/Delete,
        // as the input field would capture it.
        let was_previously_selected = true;

        content_element.listen(pointer_event("down"), (event) => {
            // The focus point will have already been removed on a device with a cursor, but on
            // touch devices, we may encounter a `pointerdown` without a corresponding
            // `pointerleave`.
            ui.focus_point.class_list.remove("revealed");

            if (event.button === 0) {
                if (ui.in_mode(UIMode.Default) || ui.in_mode(UIMode.Command)) {
                    event.stopPropagation();
                    event.preventDefault();
                    ui.dismiss_pane();

                    // If we prevent the default behaviour, then the global inputs won't be blurred,
                    // so we need to do that manually.
                    for (const input of ui.panel.global.query_selector_all('input[type="text"]')) {
                        input.element.blur();
                    }

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
                        if (this.is_vertex()) {
                            ui.reposition_focus_point(this.position);
                        }
                    } else {
                        // Toggle selection when holding Shift/Command/Control and clicking.
                        if (!ui.selection.has(this)) {
                            ui.select(this);
                        } else {
                            ui.deselect(this);
                        }
                    }

                    ui.panel.defocus_inputs();

                    // We won't start a new connection immediately, because that will hide
                    // the toolbar prematurely. Instead, we'll add a `.pending` class, which
                    // will then convert to a connection if the pointer leaves the element
                    // while remaining held.
                    this.element.class_list.add("pending");
                    ui.focus_point.class_list.remove("focused", "smooth");
                } else if (ui.in_mode(UIMode.KeyMove)) {
                    was_previously_selected = false;
                }
            }
        });

        content_element.listen(pointer_event("enter"), () => {
            if (ui.in_mode(UIMode.Connect)) {
                // The second part of the condition should not be necessary, because pointer events
                // are disabled for reconnected edges, but this acts as a warranty in case this is
                // not working.
                if ((ui.mode.source !== this || ui.mode.loop)
                    && (ui.mode.reconnect === null || ui.mode.reconnect.edge !== this)) {
                    if (
                        UIMode.Connect.valid_connection(
                            ui, ui.mode.source, this, ui.mode.reconnect)
                    ) {
                        ui.mode.target = this;
                        this.element.class_list.add("target");
                        // Hide the focus point (e.g. if we're connecting a vertex to an edge).
                        ui.focus_point.class_list.remove("revealed", "pending", "active");
                    }
                }
            }
        });

        content_element.listen(pointer_event("leave"), (event) => {
            if (event.pointerType !== "touch") {
                if (this.element.class_list.contains("pending")) {
                    this.element.class_list.remove("pending");

                    // Start connecting the node.
                    const mode = new UIMode.Connect(ui, this, false);
                    if (
                        UIMode.Connect.valid_connection(ui, mode.source, null, mode.reconnect)
                    ) {
                        ui.switch_mode(mode);
                        this.element.class_list.add("source");
                    }
                }

                if (ui.in_mode(UIMode.Connect)) {
                    if (ui.mode.target === this) {
                        ui.mode.target = null;
                    }
                    // We may not have the "target" class, but we may attempt to remove it
                    // regardless. We might still have the "target" class even if this cell
                    // is not the target, if we've immediately transitioned from targeting
                    // one cell to targeting another.
                    this.element.class_list.remove("target");
                }
            }
        });

        content_element.listen(pointer_event("up"), (event) => {
            if (event.button === 0 && event.pointerType !== "touch") {
                // If we release the pointer without ever dragging, then
                // we never begin connecting the cell.
                this.element.class_list.remove("pending");

                if (ui.in_mode(UIMode.Default)) {
                    // Focus the input if we click on a cell that was already selected. It will
                    // automatically blur when we click on the cell again, so this allows us to
                    // toggle the focus of the input when we click on any cell.
                    if (was_previously_selected) {
                        ui.panel.focus_label_input();
                    }
                }

                if (ui.in_mode(UIMode.Connect)) {
                    event.stopImmediatePropagation();

                    // Connect two cells if the source is different to the target.
                    if (ui.mode.target === this) {
                        const actions = [];
                        const cells = new Set();

                        if (ui.mode.forged_vertex) {
                            cells.add(ui.mode.source);
                        }

                        if (ui.mode.reconnect === null) {
                            // Create a new edge if we're not simply reconnecting an existing one.
                            const edge = ui.mode.connect(ui, event);
                            cells.add(edge);
                        } else {
                            // Otherwise, reconnect the existing edge.
                            const { edge, end } = ui.mode.reconnect;
                            actions.push({
                                kind: "connect",
                                edge,
                                end,
                                from: edge[end],
                                to: ui.mode.target,
                            });
                            ui.mode.connect(ui, event);
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
                    } else if (ui.mode.source === this && ui.mode.target === null) {
                        // Here, we released the pointer on the source vertex, but may have forged a
                        // vertex when we began dragging, so we need to add a history event to
                        // record it.
                        if (ui.mode.forged_vertex) {
                            ui.history.add(ui, [{
                                kind: "create",
                                cells: new Set([ui.mode.source]),
                            }]);
                        }
                    }

                    ui.switch_mode(UIMode.default);
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

    /// Whether this cell is a loop.
    is_loop() {
        return this.is_edge() && this.source === this.target;
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

// We use an ID system for cells, so that we have an identifier that the user can jump to.
Cell.NEXT_ID = 0;

/// 0-cells, or vertices. This is primarily specialised in its set up of HTML elements.
class Vertex extends Cell {
    constructor(ui, label, position, label_colour = Colour.black()) {
        super(ui.quiver, 0, label, label_colour);

        this.position = position;
        // The shape data is going to be overwritten immediately, so really this information is
        // unimportant.
        this.shape = new Shape.RoundedRect(
            Point.zero(),
            new Dimensions(ui.default_cell_size / 2, ui.default_cell_size / 2),
            ui.default_cell_size / 8,
        );
        // This property is only relevant for edges. For vertices, it is always simply the shape.
        this.phantom_shape = this.shape;

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
            this.element = new DOM.Div();
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

            ui.codes.set(this.code, this);
            // The cell content (containing the label).
            new DOM.Div({ class: "content" })
                .add(new DOM.Div({ class: "label" }))
                // The identifier that notifies the user how to jump to this cell.
                .add(new DOM.Element("kbd", {
                    "data-code": this.code,
                    class: "hint queue",
                }))
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

        if (construct) {
            ui.panel.render_tex(ui, this);
        } else {
            // The vertex may have moved, in which case we need to update the size of the grid cell
            // in which the vertex now lives, as the grid cell may now need to be resized.
            this.recalculate_size(ui);
        }
    }

    /// Calculates the size of the vertex and updates the grid accordingly. This should be called
    /// whenever the size or position may have changed.
    recalculate_size(ui) {
        const label = this.element.query_selector(".label");
        const { offsetWidth, offsetHeight } = label.element;
        ui.update_cell_size(this, offsetWidth, offsetHeight);
        this.resize_content(ui, [offsetWidth, offsetHeight]);
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
    constructor(ui, label, source, target, options, label_colour) {
        super(ui.quiver, Math.max(source.level, target.level) + 1, label, label_colour);

        this.options = Edge.default_options(Object.assign({ level: this.level }, options));

        this.arrow = new Arrow(source.shape, target.shape, new ArrowStyle(), new Label());
        if (this.source === this.target) {
            this.options.shape = "arc";
        }
        this.element = this.arrow.element;

        // `this.shape` is used for the source/target from (higher) cells connected to this one.
        // This is located at the centre of the arrow (it will be updated in `render`).
        this.shape = new Shape.Endpoint(Point.zero());
        // We also record the shape of the edge, if endpoints are not taken into account. E.g. if
        // the target of this edge is a long label XXX, then the phantom shape is the
        // arrow pointing not to the left of the first X, but to the centre of the middle X.
        this.phantom_shape = new Shape.Endpoint(Point.zero());

        this.reconnect(ui, source, target);

        this.initialise(ui);
    }

    /// A set of defaults for edge options: a basic arrow (→).
    static default_options(properties = null, style = null) {
        const options = {
            label_alignment: "left",
            label_position: 50,
            offset: 0,
            curve: 0,
            radius: 3,
            angle: 0,
            shorten: { source: 0, target: 0 },
            level: 1,
            shape: "bezier",
            colour: Colour.black(),
            // Whether to align the source and target of the current edge to the midpoint of the
            // source/target edge (`true`), or to the midpoint of the source and target of the
            // source/target edge (`false`).
            edge_alignment: { source: true, target: true },
            // For historical reasons, the following options are in a `style` subobject. Originally,
            // these were those pertaining to the edge style. However, options such as `curve` and
            // `level` also pertain to the edge style (and can only be set for arrows), but are not
            // placed in `style`. It would be possible to refactor this data structure, but it's
            // inconvenient, as we would still need to maintain support for the old data structure
            // anyway.
            style: {
                name: "arrow",
                tail: { name: "none" },
                body: { name: "cell" },
                head: { name: "arrowhead" },
            },
        };

        // Copy values in `properties` and `style` into `options`.
        const deep_assign = (target, source) => {
            if (typeof source === "undefined" || source === null) {
                return;
            }

            for (const [key, value] of Object.entries(source)) {
                if (typeof value === "object") {
                    target[key] = target[key] || {};
                    deep_assign(target[key], value);
                } else {
                    target[key] = value;
                }
            }
        };

        deep_assign(options, properties);
        deep_assign(options.style, style);

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
            ui.panel.label_input.element.blur();
            ui.focus_point.class_list.remove("focused", "smooth");

            const fixed = { source: this.target, target: this.source }[end];
            ui.switch_mode(new UIMode.Connect(ui, fixed, false, {
                end,
                edge: this,
            }));
        };

        // Set up the endpoint handle interaction events.
        for (const end of ["source", "target"]) {
            const handle = this.arrow.element.query_selector(`.arrow-endpoint.${end}`);
            // If an invalid edge has been created (e.g. during tikz-cd parsing), the arrow may not
            // have handles.
            if (handle !== null) {
                handle.listen(pointer_event("down"), (event) => {
                    if (event.button === 0) {
                        reconnect(event, end);
                    }
                });
            }
        }

        ui.panel.render_tex(ui, this);
    }

    /// Create the HTML element associated with the edge.
    /// Note that `render_tex` triggers redrawing the edge, rather than the other way around.
    render(ui, pointer_offset = null) {
        if (pointer_offset !== null) {
            const end = ui.mode.reconnect.end;
            if (ui.mode.target !== null) {
                // In this case, we're hovering over another cell.
                this.arrow[end] =
                    (ui.mode.target.is_vertex() || this.options.edge_alignment[end]) ?
                        ui.mode.target.shape : ui.mode.target.phantom_shape
            } else {
                // In this case, we're not hovering over another cell.
                // Usually we offset edge endpoints from the cells to which they are connected,
                // but when we are dragging an endpoint, we want to draw it right up to the pointer.
                this.arrow[end] = new Shape.Endpoint(pointer_offset);
            }
        } else {
            for (const end of ["source", "target"]) {
                this.arrow[end] = this.options.edge_alignment[end] ?
                    this[end].shape : this[end].phantom_shape
            }
        }

        UI.update_style(this.arrow, this.options);
        this.arrow.redraw();

        // Safari has a longstanding bug (https://bugs.webkit.org/show_bug.cgi?id=23113),
        // which means we need to correct the position of the label. We could do this
        // consistently and cleanly across browsers, but Safari is _wrong_ and deserves to
        // be treated like the subpar implementation that it is.
        if (/^((?!chrome|android).)*safari/i.test(navigator.userAgent)) {
            // The `transform` attribute has the form `translate(x, y) rotate(angle x y)` for
            // every label alignment but `OVER`, in which the `rotate` command is omitted.
            const [x, y, angle = 0] = this.arrow.label.element.parent.get_attribute("transform")
                .replace(/\s+/g, " ").match(/-?\d+(\.\d+)?/g);
            const katex_element = this.arrow.label.element.query_selector(".katex, .katex-error");
            if (katex_element !== null) {
                katex_element.set_style({
                    display: "inline-block",
                    transform: `translate(${x}px, ${y}px) rotate(${angle}deg)`,
                });
            }
        }

        // Update the origin, which is given by the centre of the edge.
        const curve = this.arrow.curve(Point.zero(), 0);
        const midpoint = curve.point(0.5);
        let centre = null;
        try {
            // Preferably, we take the centre relative to the endpoints, rather than the
            // source and target.
            const [start, end] = this.arrow.find_endpoints();
            centre = curve.point((start.t + end.t) / 2);
        } catch (_) {
            // If we're not reconnecting the edge, and we can't find the endpoints, we just take
            // the centre relative to the source and target.
            centre = midpoint;
        }
        if (centre !== null) {
            const relative_position = (position) => {
                return this.arrow.source.origin.add(
                    position.add(new Point(0, this.arrow.style.shift)).rotate(this.arrow.angle()),
                );
            };
            // `centre` will be `null` only if we've already updated the origin.
            this.shape.origin = relative_position(centre);
            this.phantom_shape.origin = relative_position(midpoint);
        }

        // Move the jump label to the centre of the edge. We may not have created the `kbd` element
        // yet, during initialisation, so we need to check.
        const jump_label = this.element.query_selector("kbd");
        if (jump_label) {
            jump_label.set_style({
                left: `${this.shape.origin.x}px`,
                top: `${this.shape.origin.y}px`,
            });
        }

        // We override the source and target whilst drawing, so we need to reset them.
        this.arrow.source = this.source.shape;
        this.arrow.target = this.target.shape;
    }

    /// Returns the angle of this edge.
    angle() {
        if (this.is_loop()) {
            return deg_to_rad(this.options.angle);
        }
        return this.target.shape.origin.sub(this.source.shape.origin).angle();
    }

    /// Changes the source and target.
    reconnect(ui, source, target) {
        ui.quiver.connect(source, target, this);
        this.options.shape = source !== target ? "bezier" : "arc";
        for (const end of ["source", "target"]) {
            if (this[end].is_vertex()) {
                this.options.edge_alignment[end] = true;
            }
        }
        for (const cell of ui.quiver.transitive_dependencies([this])) {
            cell.render(ui);
        }
        ui.panel.update(ui);
    }

    /// Flips the edge, so that what was on the left is now on the right. If `flip_arrow` is true,
    /// this includes offset and head/tail style. Otherwise it only flips the label alignment.
    flip(ui, flip_arrow, skip_dependencies = false) {
        this.options.label_alignment = {
            left: "right",
            centre: "centre",
            over: "over",
            right: "left",
        }[this.options.label_alignment];
        if (flip_arrow) {
            this.options.offset = -this.options.offset;
            this.options.curve = -this.options.curve;
            if (this.is_loop()) {
                this.options.radius = -this.options.radius;
            }
            if (this.options.style.name === "arrow") {
                const swap_sides = { top: "bottom", bottom: "top" };
                if (this.options.style.tail.name === "hook") {
                    this.options.style.tail.side = swap_sides[this.options.style.tail.side];
                }
                if (this.options.style.head.name === "harpoon") {
                    this.options.style.head.side = swap_sides[this.options.style.head.side];
                }
            }
        }

        this.render(ui);

        if (flip_arrow && !skip_dependencies) {
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

        if (this.is_loop()) {
            this.options.angle = mod(this.options.angle + 360, 360) - 180;
        }
        // Reverse the label alignment and edge offset as well as any oriented styles.
        // Flipping the label will also cause a rerender.
        // Note that since we do this, the position of the edge will remain the same, which
        // means we don't need to rerender any of this edge's dependencies.
        this.flip(ui, true, true);
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
    const body = new DOM.Element(document.body);
    const ui = new UI(body);
    ui.initialise();

    const load_quiver_from_query_string = () => {
        const query_data = url_parameters();

        // Set the initial zoom level based on the `scale` parameter.
        if (query_data.has("scale")) {
            const scale = parseFloat(decodeURIComponent(query_data.get("scale")));
            if (!Number.isNaN(scale)) {
                ui.pan_view(Offset.zero(), scale);
            }
        }

        // The `embed` parameter means that we should disable all UI elements and user interaction,
        // because the diagram is being displayed in an `<iframe>`.
        if (query_data.has("embed")) {
            ui.switch_mode(new UIMode.Embedded())
        }

        // If there is `q` parameter in the query string, try to decode it as a diagram.
        if (query_data.has("q")) {
            const dismiss_loading_screen = () => {
                // Dismiss the loading screen. We do this after a `delay` so that the loading
                // screen captures any keyboard and pointer events that occurred during loading
                // (since they are queued up while the diagram loading code is processing). We
                // don't actually remove it, because JavaScript's timing can be a bit
                // inconsistent under load.
                delay(() => {
                    document.removeEventListener("keydown", cancel);
                    document.removeEventListener("keyup", cancel);
                    // We only hide the loading screen after all the (KaTeX) fonts have been loaded.
                    // This ensures that the diagram will have been rendered correctly by the time
                    // we reveal it.
                    document.fonts.ready.then(() => {
                        ui.element.query_selector(".loading-screen").class_list.add("hidden");
                    });
                });
            };

            try {
                // Decode the diagram.
                QuiverImportExport.base64.import(ui, query_data.get("q"));
                // If there is a `macro_url`, load the macros from it.
                if (query_data.has("macro_url")) {
                    ui.load_macros_from_url(decodeURIComponent(query_data.get("macro_url")));
                }
                // Adjust the diagram scale to fit the screen in embedded view.
                // However, we have to be careful to only do this if the user
                // hasn't already set the scale explicitly.
                if (query_data.has("embed") && !query_data.has("scale")) {
                    ui.scale_to_fit();
                }
                dismiss_loading_screen();
            } catch (error) {
                if (ui.quiver.is_empty()) {
                    UI.display_error(
                        "The saved diagram was malformed and could not be loaded."
                    );
                } else {
                    // The importer will try to recover from errors, so we may have been mostly
                    // successful.
                    UI.display_error(
                        "The saved diagram was malformed and may have been loaded incorrectly."
                    );
                }
                dismiss_loading_screen();
                // Rethrow the error so that it can be reported in the console.
                throw error;
            }
        }
    };

    // Immediately load the KaTeX library.
   const rendering_library = new DOM.Element("script", {
        type: "text/javascript",
        src: "KaTeX/katex.min.js",
    }).listen("error", () => {
        // Handle KaTeX not loading (somewhat) gracefully.
        UI.display_error("KaTeX failed to load.");
        // Remove the loading screen.
        ui.element.query_selector(".loading-screen").class_list.add("hidden");
    });

    KaTeX = new Promise((accept) => {
        rendering_library.listen("load", () => {
            accept(katex);
            // KaTeX is fast enough to be worth waiting for, but not
            // immediately available. In this case, we delay loading
            // the quiver until the library has loaded.
            load_quiver_from_query_string();
        });
    });

    // Load the style sheet needed for KaTeX.
    document.head.appendChild(new DOM.Element("link", {
        rel: "stylesheet",
        href: "KaTeX/katex.css",
    }).element);

    // Trigger the script load.
    document.head.appendChild(rendering_library.element);

    // Prevent clicking on the logo from having any effect other than opening the link.
    body.query_selector("#logo-link").listen("pointerdown", (event) => {
        event.stopPropagation();
    });

    // Listen for history change events, and update the diagram accordingly.
    window.addEventListener("popstate", () => {
        ui.reset();
        load_quiver_from_query_string();
    });
});
