/// A helper object for dealing with the DOM.
const DOM = {};

/// A class for conveniently dealing with elements. It's primarily useful in giving us a way to
/// create an element and immediately set properties and styles, in a single statement.
DOM.Element = class {
    /// `from` has two forms: a plain string, in which case it is used as a `tagName` for a new
    /// element, or an existing element, in which case it is wrapped in a `DOM.Element`.
    constructor(from, attributes = {}, style = {}, namespace = null) {
        if (typeof from !== "string") {
            this.element = from;
        } else if (namespace !== null) {
            this.element = document.createElementNS(namespace, from);
        } else {
            this.element = document.createElement(from);
        }
        for (const [attribute, value] of Object.entries(attributes)) {
            this.element.setAttribute(attribute, value);
        }
        Object.assign(this.element.style, style);
    }

    get id() {
        return this.element.id;
    }

    /// Appends an element.
    /// `value` has two forms: a plain string, in which case it is added as a text node, or a
    /// `DOM.Element`, in which case the corresponding element is appended.
    add(value) {
        if (typeof value !== "string") {
            this.element.appendChild(value.element);
        } else {
            this.element.appendChild(document.createTextNode(value));
        }
        return this;
    }

    /// Adds an event listener.
    listen(type, f) {
        this.element.addEventListener(type, event => f(event, this.element));
        return this;
    }
};

/// A class for conveniently dealing with SVGs.
DOM.SVGElement = class extends DOM.Element {
    constructor(tag_name, attributes = {}, style = {}) {
        super(tag_name, attributes, style, "http://www.w3.org/2000/svg");
    }
};

/// A directed n-pseudograph, in which (k + 1)-cells can connect k-cells.
class Quiver {
    constructor() {
        /// An array of array of cells. `cells[k]` is the array of k-cells.
        /// `cells[0]` is therefore the array of objects, etc.
        this.cells = [];

        /// The inter-cell dependencies. That is: the edges that in some way are reliant on this
        /// cell. Each map entry contains a map of edges to their dependency relationship, e.g.
        /// "source" or "target".
        this.dependencies = new Map();

        /// Reverse dependencies (used for removing cells from `dependencies` when removing cells).
        /// Each map entry is simply a set, unlike `dependencies`.
        this.reverse_dependencies = new Map();
    }

    /// Add a new cell to the graph.
    add(level, cell) {
        this.dependencies.set(cell, new Map());
        this.reverse_dependencies.set(cell, new Set());

        while (this.cells.length <= level) {
            this.cells.push(new Set());
        }
        this.cells[level].add(cell);
    }

    /// Remove a cell from the graph.
    remove(cell) {
        const removed = new Set();
        const removal_queue = new Set([cell]);
        for (const cell of removal_queue) {
            this.cells[cell.level].delete(cell);
            for (const [dependency,] of this.dependencies.get(cell)) {
                removal_queue.add(dependency);
            }
            this.dependencies.delete(cell);
            for (const reverse_dependency of this.reverse_dependencies.get(cell)) {
                // If a cell is being removed as a dependency, then some of its
                // reverse dependencies may no longer exist.
                if (this.dependencies.has(reverse_dependency)) {
                    this.dependencies.get(reverse_dependency).delete(cell);
                }
            }
            this.reverse_dependencies.delete(cell);
            removed.add(cell);
        }
        return removed;
    }

    /// Connect two cells. Note that this does *not* check whether the source and
    /// target are compatible with each other.
    connect(source, target, edge) {
        this.dependencies.get(source).set(edge, "source");
        this.dependencies.get(target).set(edge, "target");

        this.reverse_dependencies.get(edge).add(source);
        this.reverse_dependencies.get(edge).add(target);
    }

    /// Returns whether the quiver is empty.
    is_empty() {
        return this.dependencies.size === 0;
    }

    /// Return a string containing the graph in a specific format.
    /// Currently, the supported formats are:
    /// - "tikzcd"
    export(format) {
        switch (format) {
            case "tikzcd":
                return QuiverExport.tikzcd.export(this);
            default:
                throw new Error(`unknown export format \`${format}\``);
        }
    }
}

/// Various methods of exporting a quiver.
class QuiverExport {
    /// A method to export a quiver as a string.
    export() {}
}

QuiverExport.tikzcd = new class extends QuiverExport {
    export(quiver) {
        let output = "";

        // Wrap tikzcd code with `\begin{tikzcd} ... \end{tikzcd}`.
        const wrap_boilerplate = (output) => {
            return `\\begin{tikzcd}\n${
                output.length > 0 ? `${
                    output.split("\n").map(line => `\t${line}`).join("\n")
                }\n` : ""
            }\\end{tikzcd}`;
        };

        // Early exit for empty quivers.
        if (quiver.is_empty()) {
            return wrap_boilerplate(output);
        }

        // We handle the export in two stages: vertices and edges. These are fundamentally handled
        // differently in tikzcd, so it makes sense to separate them in this way. We have a bit of
        // flexibility in the format in which we output (e.g. edges relative to nodes, or with
        // absolute positions).
        // We choose to lay out the tikzcd code as follows:
        //    (vertices)
        //    X & X & X \\
        //    X & X & X \\
        //    X & X & X
        //    (1-cells)
        //    (2-cells)
        //    ...

        // Output the vertices.
        // Note that currently vertices may not share the same position,
        // as in that case they will be overwritten.
        let offset = new Position(Infinity, Infinity);
        // Construct a grid for the vertices.
        const rows = new Map();
        for (const vertex of quiver.cells[0]) {
            if (!rows.has(vertex.position.y)) {
                rows.set(vertex.position.y, new Map());
            }
            rows.get(vertex.position.y).set(vertex.position.x, vertex);
            offset = offset.min(vertex.position);
        }
        // Iterate through the rows and columns in order, outputting the tikzcd code.
        const prev = new Position(offset.x, offset.y);
        for (const [y, row] of Array.from(rows).sort()) {
            if (y - prev.y > 0) {
                output += ` ${"\\\\\n".repeat(y - prev.y)}`;
            }
            // This variable is really unnecessary, but it allows us to remove
            //  a leading space on a line, which makes things prettier.
            let first_in_row = true;
            for (const [x, vertex] of Array.from(row).sort()) {
                if (x - prev.x > 0) {
                    output += `${!first_in_row ? " " : ""}${"&".repeat(x - prev.x)} `;
                }
                output += `{${vertex.label}}`;
                prev.x = x;
                first_in_row = false;
            }
            prev.x = offset.x;
        }

        // Referencing cells is slightly complicated by the fact that we can't give vertices
        // names in tikzcd, so we have to refer to them by position instead. That means 1-cells
        // have to be handled differently to k-cells for k > 1.
        // A map of unique identifiers for cells.
        const names = new Map();
        let index = 0;
        const cell_reference = (cell) => {
            if (cell.level === 0) {
                // Note that tikzcd 1-indexes its cells.
                return `${cell.position.y - offset.y + 1}-${cell.position.x - offset.x + 1}`;
            } else {
                return `${names.get(cell)}`;
            }
        };

        // Output the edges.
        for (let level = 1; level < quiver.cells.length; ++level) {
            if (quiver.cells[level].size > 0) {
                output += "\n";
            }

            for (const edge of quiver.cells[level]) {
                const parameters = [];
                const label_parameters = [];
                let align = "";

                // We only need to give edges names if they're depended on by another edge.
                if (quiver.dependencies.get(edge).size > 0) {
                    label_parameters.push(`name=${index}`);
                    names.set(edge, index++);
                    // In this case, because we have a parameter list, we have to also change
                    // the syntax for alignment (technically, we can always use the quotation
                    // mark for swap, but it's simpler to be consistent with `description`).
                    switch (edge.options.label_alignment) {
                        case "centre":
                            label_parameters.push("description");
                            break;
                        case "right":
                            label_parameters.push("swap");
                            break;
                    }
                } else {
                    switch (edge.options.label_alignment) {
                        case "centre":
                            // Centring is done by using the `description` style.
                            align = " description";
                            break;
                        case "right":
                            // We can flip the side of the edge on which the label is drawn
                            // by appending a quotation mark to the label as an edge option.
                            align = "'";
                            break;
                    }
                }
                if (edge.options.offset > 0) {
                    parameters.push(`shift right=${edge.options.offset}`);
                }
                if (edge.options.offset < 0) {
                    parameters.push(`shift left=${-edge.options.offset}`);
                }

                let style = "";
                let label = `"{${edge.label}}"${align}`;

                // Edge styles.
                switch (edge.options.style.name) {
                    case "arrow":
                        // Body styles.
                        switch (edge.options.style.body.name) {
                            case "cell":
                                // tikzcd only has supported for 1-cells and 2-cells.
                                // Anything else requires custom support, so for now
                                // we only special-case 2-cells. Everything else is
                                // drawn as if it is a 1-cell.
                                if (edge.options.style.body.level === 2) {
                                    style = "Rightarrow, ";
                                }
                                break;

                            case "dashed":
                                parameters.push("dashed");
                                break;

                            case "dotted":
                                parameters.push("dotted");
                                break;

                            case "squiggly":
                                parameters.push("squiggly");
                                break;
                        }

                        // Tail styles.
                        switch (edge.options.style.tail.name) {
                            case "maps to":
                                parameters.push("maps to");
                                break;

                            case "mono":
                                parameters.push("tail");
                                break;
                        }

                        // Head styles.
                        switch (edge.options.style.head.name) {
                            case "none":
                                parameters.push("no head");
                                break;

                            case "epi":
                                parameters.push("two heads");
                                break;

                            case "harpoon":
                                parameters.push(`harpoon${
                                    edge.options.style.head.side === "top" ? "" : "'"
                                }`);
                                break;
                        }

                        break;

                    case "adjunction":
                    case "corner":
                        parameters.push("phantom");

                        let angle_offset = 0;

                        switch (edge.options.style.name) {
                            case "adjunction":
                                label = "\"\\dashv\"";
                                break;
                            case "corner":
                                label = "\"\\lrcorner\"";
                                label_parameters.push("very near start");
                                angle_offset = 45;
                                break;
                        }

                        label_parameters.push(`rotate=${
                            -edge.angle() * 180 / Math.PI + angle_offset
                        }`);

                        // We allow these sorts of edges to have labels attached,
                        // even though it's a little unusual.
                        if (edge.label.trim() !== "") {
                            let anchor = "";
                            switch (edge.options.label_alignment) {
                                case "left":
                                    anchor = "anchor=west, ";
                                    break;
                                case "centre":
                                    anchor = "description, ";
                                    break;
                                case "right":
                                    anchor = "anchor=east, ";
                                    break;
                            }
                            parameters.push(`"{${edge.label}}"{${anchor}inner sep=1.5mm}`);
                        }

                        break;
                }

                // tikzcd tends to place arrows between arrows directly contiguously
                // without adding some spacing manually.
                if (level > 1) {
                    parameters.push("shorten <=1mm");
                    parameters.push("shorten >=1mm");
                }

                output += `\\arrow[${style}` +
                    `${label}${
                        label_parameters.length > 0 ? `{${label_parameters.join(", ")}}` : ""
                    }, ` +
                    `from=${cell_reference(edge.source)}, ` +
                    `to=${cell_reference(edge.target)}` +
                    (parameters.length > 0 ? `, ${parameters.join(", ")}` : "") +
                    "] ";
            }
            // Remove the trailing space.
            output = output.slice(0, -1);
        }

        return wrap_boilerplate(output);
    }
};

/// A quintessential (x, y) position.
class Position {
    constructor(x, y) {
        [this.x, this.y] = [x, y];
    }

    toString() {
        return `${this.x} ${this.y}`;
    }

    eq(other) {
        return this.x === other.x && this.y === other.y;
    }

    add(other) {
        return new Position(this.x + other.x, this.y + other.y);
    }

    sub(other) {
        return new Position(this.x - other.x, this.y - other.y);
    }

    div(divisor) {
        return new Position(this.x / divisor, this.y / divisor);
    }

    min(other) {
        return new Position(Math.min(this.x, other.x), Math.min(this.y, other.y));
    }

    length() {
        return Math.hypot(this.y, this.x);
    }

    angle() {
        return Math.atan2(this.y, this.x);
    }
}

/// An (width, height) pair. This is functionally equivalent to `Position`, but has different
/// semantic intent.
const Dimensions = class extends Position {
    get width() {
        return this.x;
    }

    get height() {
        return this.y;
    }
};

/// An HTML position. This is functionally equivalent to `Position`, but has different semantic
/// intent.
class Offset {
    constructor(left, top) {
        [this.left, this.top] = [left, top];
    }

    /// Return a [left, top] arrow of CSS length values.
    to_CSS() {
        return [`${this.left}px`, `${this.top}px`];
    }

    /// Moves an `element` to the offset.
    reposition(element) {
        [element.style.left, element.style.top] = this.to_CSS();
    }
}

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
UIState.default = new class extends UIState {};

/// Two k-cells are being connected by an (k + 1)-cell.
UIState.Connect = class extends UIState {
    constructor(ui, source, target = null) {
        super();

        this.name = "connect";

        /// The source of a connection between two cells.
        this.source = source;

        /// The target of a connection between two cells.
        this.target = target;

        /// The overlay for drawing an edge between the source and the cursor.
        this.overlay = new DOM.Element("div", { class: "edge overlay" })
            .add(new DOM.SVGElement("svg"))
            .element;
        ui.element.appendChild(this.overlay);
    }

    release() {
        this.overlay.remove();
        this.source.element.classList.remove("source");
        if (this.target !== null) {
            this.target.element.classList.remove("target");
        }
    }

    /// Update the overlay with a new cursor position.
    update(ui, position) {
        // We're drawing the edge again from scratch, so we need to remove all existing elements.
        const svg = this.overlay.querySelector("svg");
        while (svg.firstChild) {
            svg.removeChild(svg.firstChild);
        }
        if (!position.eq(this.source.position)) {
            Edge.prototype.draw_and_position_edge(
                ui,
                this.overlay,
                svg,
                this.source.level + 1,
                this.source.position,
                // Lock on to the target if present, otherwise simply draw the edge
                // to the position of the cursor.
                this.target !== null ? this.target.position : position,
                Edge.prototype.default_options(null, { body: { name: "cell", level: this.source.level + 1 } }),
                this.target !== null,
                null,
            );
        }
    }

    /// Returns whether the `source` is compatible with the specified `target`.
    /// This first checks that the source is valid at all.
    // We currently only support 0-cells, 1-cells and 2-cells. This is solely
    // due to a restriction with tikzcd. This restriction can be lifted in
    // the editor with no issue.
    valid_connection(target) {
        return this.source.level <= 1 &&
            // To allow `valid_connection` to be used to simply check whether the source is valid,
            // we ignore source–target compatibility if `target` is null.
            (target === null || this.source.level === target.level);
    }

    /// Connects the source and target. Note that this does *not* check whether the source and
    /// target are compatible with each other.
    connect(ui) {
        const label = ui.debug ? `${
            String.fromCharCode("A".charCodeAt(0) + Math.floor(Math.random() * 26))
        }` : "";
        ui.deselect();

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
                label_alignment:
                    { left: "right", centre: "centre", right: "left" }[options.label_alignment],
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

        const source_dependencies = ui.quiver.dependencies.get(this.source);
        const target_dependencies = ui.quiver.dependencies.get(this.target);
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

        // The edge itself does all the set up, such as adding itself to the page.
        ui.select(new Edge(ui, label, this.source, this.target, options));
        ui.panel.element.querySelector('label input[type="text"]').focus();
    }
};

/// Cells are being moved to a different position.
UIState.Move = class extends UIState {
    constructor(origin, selection) {
        super();

        this.name = "move";

        /// The location from which the move was initiated (used to update positions relative to the
        /// origin).
        this.origin = origin;

        /// The group of cells that should be moved.
        this.selection = selection;
    }
};

class UI {
    constructor(element) {
        /// The quiver identified with the UI.
        this.quiver = new Quiver();

        /// The UI state (e.g. whether cells are being rearranged, or connected, etc.).
        this.state = UIState.default;

        /// The size of each 0-cell.
        this.cell_size = 128;

        /// All currently selected cells;
        this.selection = new Set();

        /// The element in which to place cells.
        this.element = element;

        /// A map from `x,y` positions to vertices. Note that this
        /// implies that only one vertex may occupy each position.
        this.positions = new Map();

        /// A set of unique idenitifiers for various objects (used for generating HTML `id`s).
        this.ids = new Map();

        /// The panel for viewing and editing cell data.
        this.panel = new Panel();

        /// A debug mode for convenience. Adds default random labels to cells.
        this.debug = false;
    }

    initialise() {
        this.element.classList.add("ui");

        // Set up the panel for viewing and editing cell data.
        this.panel.initialise(this);
        this.element.appendChild(this.panel.element);

        // Stop trying to connect or move cells when the mouse is released.
        document.addEventListener("mouseup", (event) => {
            if (event.button === 0) {
                this.switch_mode(UIState.default);
            }
        });

        // Stop dragging cells when the mouse leaves the window.
        this.element.addEventListener("mouseleave", () => {
            if (this.in_mode(UIState.Move)) {
                this.switch_mode(UIState.default);
            }
        });

        // Deselect cells when the mouse is pressed.
        this.element.addEventListener("mousedown", (event) => {
            if (event.button === 0) {
                this.deselect();
            }
        });

        // Handle global key presses (such as keyboard shortcuts).
        document.addEventListener("keydown", event => {
            switch (event.key) {
                case "Backspace":
                    // Remove any selected cells.
                    if (!(document.activeElement instanceof HTMLInputElement)) {
                        for (const cell of this.selection) {
                            // Remove this cell and its dependents from the quiver
                            // and then from the HTML.
                            for (const removed of this.quiver.remove(cell)) {
                                removed.element.remove();
                            }
                        }
                        this.selection = new Set();
                        this.panel.update(this);
                    }
                    break;
                case "Enter":
                    // Focus the label input.
                    this.panel.element.querySelector('label input[type="text"]').focus();
                    break;
                case "Escape":
                    // Stop trying to connect cells.
                    if (this.in_mode(UIState.Connect)) {
                        this.switch_mode(UIState.default);
                    }
                    // Defocus the label input.
                    this.panel.element.querySelector('label input[type="text"]').blur();
                    // Close any open panes.
                    this.panel.dismiss_export_pane(this);
                    break;
            }
        });

        // Add the insertion point for new nodes.
        const insertion_point = new DOM.Element("div", { class: "insertion-point" }).element;
        this.element.appendChild(insertion_point);

        // Clicking on the insertion point reveals it,
        // after which another click adds a new node.
        insertion_point.addEventListener("mousedown", (event) => {
            if (event.button === 0) {
                if (!insertion_point.classList.contains("revealed")) {
                    // Reveal the insertion point upon a click.
                    insertion_point.classList.add("revealed");
                } else {
                    // We only stop propagation in this branch, so that clicking once in an
                    // empty grid cell will deselect any selected cells, but clicking a second
                    // time to add a new vertex will not deselect the new, selected vertex we've
                    // just added. Note that it's not possible to select other cells in between
                    // the first and second click, because leaving the grid cell with the cursor
                    // (to select other cells) hides the insertion point again.
                    event.stopPropagation();
                    insertion_point.classList.remove("revealed");
                    const label = this.debug ? `\\mathscr{${
                        String.fromCharCode("A".charCodeAt(0) + Math.floor(Math.random() * 26))
                    }}` : "\\bullet";
                    const vertex = new Vertex(this, label, this.position_from_event(event));
                    this.select(vertex);
                    event.preventDefault();
                    this.panel.element.querySelector('label input[type="text"]').select();
                }
            }
        });

        // If the cursor leaves the insertion point, it gets hidden again.
        insertion_point.addEventListener("mouseleave", () => {
            insertion_point.classList.remove("revealed");
        });

        // Moving the insertion point, and rearranging cells.
        this.element.addEventListener("mousemove", (event) => {
            const position = this.position_from_event(event);
            const offset = this.offset_from_position(position);
            offset.reposition(insertion_point);

            if (this.in_mode(UIState.Move)) {
                // Prevent dragging from selecting random elements.
                event.preventDefault();

                // We will only try to reposition if the new position is actually different
                // (rather than the cursor simply having moved within the same grid cell).
                // On top of this, we prevent vertices from being moved into grid cells that
                // are already occupied by vertices.
                if (!position.eq(this.state.origin) && !this.positions.has(`${position}`)) {
                    // We'll need to move all of the edges connected to the moved vertices,
                    // so we keep track of which we need to update in `render_queue`.
                    const render_queue = new Set();
                    // Move all the selected vertices.
                    for (const cell of this.state.selection) {
                        if (cell.level === 0) {
                            const position_delta = cell.position.sub(this.state.origin);
                            this.reposition(cell, position.add(position_delta));
                            // Track all of the edges dependent on this vertex.
                            for (const [dependency,] of this.quiver.dependencies.get(cell)) {
                                render_queue.add(dependency);
                            }
                        }
                    }
                    this.state.origin = position;

                    // Move all of the edges connected to cells that have moved.
                    // We're relying on the iteration order of the set here.
                    for (const edge of render_queue) {
                        edge.render(this);
                        // Track all of the edges dependent on this edge.
                        for (const [dependency,] of this.quiver.dependencies.get(edge)) {
                            render_queue.add(dependency);
                        }
                    }

                    // Update the panel, so that the interface is kept in sync (e.g. the
                    // rotation of the label alignment buttons).
                    this.panel.update(this);
                }
            }

            if (this.in_mode(UIState.Connect)) {
                // Prevent dragging from selecting random elements.
                event.preventDefault();

                this.state.update(this, this.position_from_event(event, false));
            }
        });

        // Set the grid background.
        this.set_background(this.element);
    }

    /// Returns whether the UI has a particular state.
    in_mode(state) {
        return this.state instanceof state;
    }

    /// Transitions to a `UIState`.
    switch_mode(state) {
        if (this.state.constructor !== state.constructor) {
            // Clean up any state for which this state is responsible.
            this.state.release();
            if (this.state.name !== null) {
                this.element.classList.remove(this.state.name);
            }
            this.state = state;
            if (this.state.name !== null) {
                this.element.classList.add(this.state.name);
            }
        }
    }

    /// A helper method for getting a position from an event.
    position_from_event(event, round = true) {
        const transform = round ? Math.round : x => x;
        return new Position(
            transform(event.pageX / this.cell_size - 0.5),
            transform(event.pageY / this.cell_size - 0.5),
        );
    }

    /// A helper method for getting an HTML (left, top) position from a grid `Position`.
    offset_from_position(position, account_for_centring = true) {
        return new Offset(
            position.x * this.cell_size + (account_for_centring ? this.cell_size / 2 : 0),
            position.y * this.cell_size + (account_for_centring ? this.cell_size / 2 : 0),
        );
    }

    /// Selects a specific `cell`. Note that this does *not* deselect any cells that were
    /// already selected.
    select(cell) {
        if (!this.selection.has(cell)) {
            this.selection.add(cell);
            cell.select();

            this.panel.update(this);
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
            if (this.selection.delete(cell)) {
                cell.deselect();
            }
        }

        this.panel.update(this);
    }

    /// Adds a cell to the canvas.
    add_cell(cell) {
        if (cell.level === 0) {
            this.positions.set(`${cell.position}`, cell);
        }
        this.element.appendChild(cell.element);
    }

    /// Moves a cell to a new position. This is specifically intended for vertices.
    reposition(cell, position) {
        if (!this.positions.has(`${position}`)) {
            this.positions.delete(`${cell.position}`);
            cell.position = position;
            this.positions.set(`${cell.position}`, cell);
            cell.render(this);
        } else {
            throw new Error(
                "new cell position already contains a cell:",
                this.positions.get(`${position}`),
            );
        }
    }

    /// Returns a unique identifier for an object.
    unique_id(object) {
        if (!this.ids.has(object)) {
            this.ids.set(object, this.ids.size);
        }
        return this.ids.get(object);
    }

    /// Renders TeX with MathJax and returns the corresponding element.
    render_tex(tex = "", after = x => x) {
        // We're going to fade the label in once it's rendered, so it looks less janky.
        const label = new DOM.Element("div", { class: "label" }, { opacity: 0 })
            .add(`\\(${tex}\\)`)
            .element;
        MathJax.Hub.queue.Push(
            ["Typeset", MathJax.Hub, label],
            () => label.style.opacity = 1,
            after,
        );
        return label;
    }

    // Set the grid background for the canvas.
    set_background() {
        // Constants for parameters of the grid pattern.
        // The width of the cell border lines.
        const BORDER_WIDTH = 2;
        // The (average) length of the dashes making up the cell border lines.
        const DASH_LENGTH = 6;
        // The border colour.
        const BORDER_COLOUR = "lightgrey";

        // Construct the linear gradient corresponding to the dashed pattern (in a single cell).
        let dashes = "";
        let x = 0;
        while (x + DASH_LENGTH * 2 < this.cell_size) {
            dashes += `
                transparent ${x += DASH_LENGTH}px, white ${x}px,
                white ${x += DASH_LENGTH}px, transparent ${x}px,
            `;
        }
        // Slice off the whitespace and trailing comma.
        dashes = dashes.trim().slice(0, -1);
        // Because we're perfectionists, we want to position the dashes so that the dashes forming
        // the corners of each cell make a perfect symmetrical cross. This works out how to offset
        // the dashes to do so. Full disclosure: I derived this equation observationally and it may
        // not behave perfectly for all parameters.
        const dash_offset = (2 * (this.cell_size / 16 % (DASH_LENGTH / 2)) - 1 + DASH_LENGTH)
            % DASH_LENGTH + 1 - (DASH_LENGTH / 2);

        const grid_background = `
            linear-gradient(${dashes}),
            linear-gradient(90deg, transparent ${this.cell_size - BORDER_WIDTH}px, ${BORDER_COLOUR} 0),
            linear-gradient(90deg, ${dashes}),
            linear-gradient(transparent ${this.cell_size - BORDER_WIDTH}px, ${BORDER_COLOUR} 0)
        `;

        this.element.style.setProperty("--cell-size", `${this.cell_size}px`);
        this.element.style.backgroundImage = grid_background;
        this.element.style.backgroundPosition = `
            0 ${dash_offset}px,
            ${BORDER_WIDTH / 2}px 0,
            ${dash_offset}px 0,
            0px ${BORDER_WIDTH / 2}px
        `;
    }
}

/// A panel for editing cell data.
class Panel {
    constructor() {
        /// The panel element.
        this.element = null;

        /// The export pane element (`null` if not currently shown).
        this.export = null;
    }

    /// Set up the panel interface elements.
    initialise(ui) {
        this.element = new DOM.Element("div", { class: "panel" }).element;

        // Prevent propogation of mouse events when interacting with the panel.
        this.element.addEventListener("mousedown", (event) => {
            event.stopImmediatePropagation();
        });

        // The label.
        const label_input = new DOM.Element("input", { type: "text", disabled: true });
        const label = new DOM.Element("label").add("Label: ").add(label_input).element;
        this.element.appendChild(label);

        // We buffer the MathJax rendering to reduce flickering.
        // If the `.buffer` has no extra classes, then we are free to start a new MathJax
        // TeX render.
        // If the `.buffer` has a `.buffering` class, then we are rendering a label. This
        // may be out of date, in which case we add a `.pending` class (which means we're
        // going to rerender as soon as the current MathJax render has completed).
        const render_tex = (cell) => {
            const label = cell.element.querySelector(".label:not(.buffer)");
            const buffer = cell.element.querySelector(".buffer");
            const jax = MathJax.Hub.getAllJax(buffer);
            if (!buffer.classList.contains("buffering") && jax.length > 0) {
                buffer.classList.add("buffering");
                MathJax.Hub.Queue(
                    ["Text", jax[0], cell.label],
                    () => {
                        // Swap the label and the label buffer.
                        label.classList.add("buffer");
                        buffer.classList.remove("buffer", "buffering");
                    },
                    () => {
                        if (cell.level > 0) {
                            cell.update_label_transformation();
                        }
                    },
                );
            } else if (!buffer.classList.contains("pending")) {
                MathJax.Hub.Queue(() => render_tex(cell));
            }
        };
        // Handle label interaction: update the labels of the selected cells when
        // the input field is modified.
        label_input.listen("input", () => {
            for (const selected of ui.selection) {
                selected.label = label_input.element.value;
                render_tex(selected);
            }
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
            [["left",], ["centre",], ["right",]],
            "label-alignment",
            [],
            false, // `disabled`
            (selected, value) => selected.options.label_alignment = value,
            (value) => {
                // The length of the arrow.
                const ARROW_LENGTH = 28;

                let y_offset;
                switch (value) {
                    case "left":
                        y_offset = -Y_OFFSET;
                        break;
                    case "centre":
                        y_offset = 0;
                        break;
                    case "right":
                        y_offset = Y_OFFSET;
                        break;
                }

                const gap = y_offset === 0 ? { length: RADIUS * 4, offset: X_OFFSET } : null;

                return {
                    edge: {
                        length: ARROW_LENGTH,
                        options: Edge.prototype.default_options(),
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
        this.element.appendChild(
            new DOM.Element("label").add("Offset: ").add(
                new DOM.Element(
                    "input",
                    { type: "range", min: -3, value: 0, max: 3, step: 1, disabled: true }
                ).listen("input", (_, slider) => {
                    for (const selected of ui.selection) {
                        if (selected.level > 0) {
                            // Update the actual `value` attribute so that we can
                            // reference it in the CSS.
                            slider.setAttribute("value", slider.value);
                            selected.options.offset = parseInt(slider.value);
                            selected.render(ui);
                        }
                    }
                })
            ).element
        );

        // The button to reverse an edge.
        this.element.appendChild(
            new DOM.Element("button", { disabled: true }).add("⇌ Reverse").listen("click", () => {
                for (const selected of ui.selection) {
                    if (selected.level > 0) {
                        selected.reverse(ui);
                    }
                }
                this.update(ui);
            }).element
        );

        // The list of tail styles.
        // The length of the arrow to draw in the centre style buttons.
        const ARROW_LENGTH = 72;

        this.create_option_list(
            ui,
            [
                ["none", { name: "none" }],
                ["maps to", { name: "maps to" }],
                ["mono", { name: "mono"} ],
            ],
            "tail-type",
            ["vertical", "short", "arrow-style"],
            true, // `disabled`
            (selected, _, data) => selected.options.style.tail = data,
            (_, data) => {
                return {
                    edge: {
                        length: 0,
                        options: Edge.prototype.default_options(null, {
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
            [
                ["1-cell", { name: "cell", level: 1 }],
                ["2-cell", { name: "cell", level: 2 }],
                ["dashed", { name: "dashed" }],
                ["dotted", { name: "dotted" }],
                ["squiggly", { name: "squiggly" }],
            ],
            "body-type",
            ["vertical", "arrow-style"],
            true, // `disabled`
            (selected, _, data) => selected.options.style.body = data,
            (_, data) => {
                return {
                    edge: {
                        length: ARROW_LENGTH,
                        options: Edge.prototype.default_options(null, {
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
            [
                ["arrowhead", { name: "arrowhead" }],
                ["none", { name: "none" }],
                ["epi", { name: "epi"} ],
                ["top-harpoon", { name: "harpoon", side: "top" }, ["short"]],
                ["bottom-harpoon", { name: "harpoon", side: "bottom" }, ["short"]],
            ],
            "head-type",
            ["vertical", "short", "arrow-style"],
            true, // `disabled`
            (selected, _, data) => selected.options.style.head = data,
            (_, data) => {
                return {
                    edge: {
                        length: 0,
                        options: Edge.prototype.default_options(null, {
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
            [
                ["arrow", Edge.prototype.default_options().style],
                ["adjunction", { name: "adjunction" }],
                ["corner", { name: "corner" }],
            ],
            "edge-type",
            ["vertical", "centre"],
            true, // `disabled`
            (selected, _, data) => {
                // Update the edge style.
                selected.options.style = data;

                // Enable/disable the arrow style buttons.
                ui.element.querySelectorAll('.arrow-style input[type="radio"]')
                    .forEach(element => element.disabled = data.name !== "arrow");

                // If we've selected the `"arrow"` style, then we need to
                // trigger the currently-checked buttons so that we get
                // the expected style, rather than the default style.
                if (data.name === "arrow") {
                    ui.element.querySelectorAll('.arrow-style input[type="radio"]:checked')
                        .forEach(element => element.dispatchEvent(new Event("change")));
                }
            },
            (_, data) => {
                return {
                    edge: {
                        length: ARROW_LENGTH,
                        options: Edge.prototype.default_options(null, data),
                    },
                };
            },
        );

        // The export button.
        this.element.appendChild(
            new DOM.Element("div", { class: "bottom" }).add(
                new DOM.Element("button", { class: "global" }).add("Export to LaTeX")
                    .listen("click", () => {
                        // Handle export button interaction: export the quiver.
                        if (this.export === null) {
                            // Get the tikzcd diagram code.
                            const output = ui.quiver.export("tikzcd");
                            // Create the export pane.
                            this.export = new DOM.Element("div", { class: "export" })
                                .add(output)
                                .element;
                            ui.element.appendChild(this.export);
                            // Select the code for easy copying.
                            const selection = window.getSelection();
                            const range = document.createRange();
                            range.selectNodeContents(this.export);
                            selection.removeAllRanges();
                            selection.addRange(range);
                            // Disable cell data editing while the export pane is visible.
                            this.update(ui);
                        } else {
                            this.dismiss_export_pane(ui);
                        }
                    })
            ).element
        );
    }

    // A helper function for creating a list of radio inputs with backgrounds drawn based
    // on `draw_edge` with various arguments. This allows for easily customising edges
    // with visual feedback.
    create_option_list(
        ui,
        entries,
        name,
        classes,
        disabled,
        on_check,
        properties,
        augment_svg = () => [],
    ) {
        const options_list = new DOM.Element("div", { class: `options` }).element;
        options_list.classList.add(...classes);

        const create_option = (value, data) => {
            const button = new DOM.Element("input", {
                type: "radio",
                name,
                value,
            }).listen("change", (_, button) => {
                if (button.checked) {
                    for (const selected of ui.selection) {
                        if (selected.level > 0) {
                            on_check(selected, value, data);
                            selected.render(ui);
                        }
                    }
                }
            }).element;
            button.disabled = disabled;
            options_list.appendChild(button);

            // We're going to create background images for the label alignment buttons
            // representing each of the alignments. We do this by creating SVGs so that
            // the images are precisely right.
            // We create two background images per button: one for the `:checked` version
            // and one for the unchecked version.
            const backgrounds = [];

            const svg = new DOM.SVGElement("svg", { xmlns: "http://www.w3.org/2000/svg" }).element;

            const { shared, edge: { length, options, gap = null } } = properties(value, data);

            const { dimensions, alignment } = Edge.prototype.draw_edge(svg, options, length, gap);
            // Align the background according the alignment of the arrow
            // (`"centre"` is default).
            if (alignment !== "centre") {
                // What percentage of the button to offset `"left"` or `"right"` aligned arrows.
                const BACKGROUND_PADDING = 20;

                button.style.backgroundPosition = `${alignment} ${BACKGROUND_PADDING}% center`
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
            button.style.backgroundImage = backgrounds.join(", ");

            return button;
        };

        for (const [value, data, classes = []] of entries) {
            create_option(value, data).classList.add(...classes);
        }

        options_list.querySelector(`input[name="${name}"]`).checked = true;

        this.element.appendChild(options_list);
    }

    /// Update the panel state (i.e. enable/disable fields as relevant).
    update(ui) {
        const input = this.element.querySelector('label input[type="text"]');
        const label_alignments = this.element.querySelectorAll('input[name="label-alignment"]');
        const slider = this.element.querySelector('input[type="range"]');

        if (this.export === null) {
            if (ui.selection.size === 1) {
                const cell = ui.selection.values().next().value;
                input.value = cell.label;
                input.disabled = false;
                if (cell.level > 0) {
                    this.element.querySelector(
                        `input[name="label-alignment"][value="${cell.options.label_alignment}"]`
                    ).checked = true;

                    // Rotate the label alignment buttons to reflect the direction of the arrow
                    // (at least to the nearest multiple of 90°).
                    const angle = cell.angle();
                    for (const option of label_alignments) {
                        option.style.transform = `rotate(${
                            Math.round(2 * angle / Math.PI) * 90
                        }deg)`;
                    }

                    slider.value = cell.options.offset;
                    // Update the actual `value` attribute so that we can reference it in the CSS.
                    slider.setAttribute("value", slider.value);
                    slider.disabled = false;

                    // Enable the Reverse button.
                    this.element.querySelector('button').disabled = false;

                    const style_is_arrow = cell.options.style.name === "arrow";
                    // Disable/enable the arrow style buttons.
                    for (const option of this.element.querySelectorAll('input[type="radio"]')) {
                        option.disabled = !style_is_arrow
                            && option.parentElement.classList.contains("arrow-style");
                    }
                    // Check the correct edge style button.
                    this.element.querySelector(
                        `input[name="edge-type"][value="${cell.options.style.name}"]`
                    ).checked = true;
                    // Check the correct arrow style buttons.
                    if (style_is_arrow) {
                        for (const component of ["tail", "body", "head"]) {
                            let value;
                            // The following makes the assumption that names are unique,
                            // even between different components.
                            switch (cell.options.style[component].name) {
                                case "cell":
                                    value = `${cell.options.style[component].level}-cell`;
                                    break;
                                case "harpoon":
                                    value = `${cell.options.style[component].side}-harpoon`;
                                    break;
                                default:
                                    value = cell.options.style[component].name;
                                    break;
                            }

                            this.element.querySelector(
                                `input[name="${component}-type"][value="${value}"]`
                            ).checked = true;
                        }
                    }
                }
            } else {
                // Reset the inputs when multiple cells are selected.
                input.value = "";
                slider.value = 0;

                // Disable all the inputs.
                this.element.querySelectorAll("input, button:not(.global)")
                    .forEach(element => element.disabled = true);
            }
            for (const option of label_alignments) {
                option.disabled = false;
            }
        } else {
            // Disable all the inputs.
            this.element.querySelectorAll("input, button:not(.global)")
            .forEach(element => element.disabled = true);
        }
    }

    /// Dismiss the export pane, if it is shown.
    dismiss_export_pane(ui) {
        if (this.export !== null) {
            this.export.remove();
            this.export = null;
            this.update(ui);
        }
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
        quiver.add(this.level, this);

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
                    event.stopPropagation();
                    // If the cell we're dragging is part of the existing selection,
                    // then we'll move every cell that is selected. However, if it's
                    // not already part of the selection, we'll just drag this cell
                    // and ignore the selection.
                    const move = new Set(ui.selection.has(this) ? [...ui.selection] : [this]);
                    ui.switch_mode(new UIState.Move(ui.position_from_event(event), move));
                }
            });
        }

        // We record whether a cell was already selected when we click on it, because
        // we only want to trigger a label input focus if we click on a cell that is
        // already selected. Clicking on an unselected cell should not focus the input,
        // or we wouldn't be able to immediately delete a cell with Backspace, as the
        // input field would capture it.
        let was_previously_selected;
        content_element.addEventListener("mousedown", (event) => {
            if (event.button === 0) {
                event.stopPropagation();
                event.preventDefault();

                const label_input = ui.panel.element.querySelector('label input[type="text"]');
                was_previously_selected = ui.selection.has(this) &&
                    // If the label input is already focused, then we defocus it.
                    // This allows the user to easily switch between editing the
                    // entire cell and the label.
                    document.activeElement !== label_input;
                // Deselect all other nodes.
                ui.deselect();
                ui.select(this);
                const state = new UIState.Connect(ui, this);
                if (state.valid_connection(null)) {
                    ui.switch_mode(state);
                    this.element.classList.add("source");
                }
            }
        });

        content_element.addEventListener("mouseenter", () => {
            if (ui.in_mode(UIState.Connect)) {
                if (ui.state.source !== this) {
                    if (ui.state.valid_connection(this)) {
                        ui.state.target = this;
                        this.element.classList.add("target");
                    }
                }
            }
        });

        content_element.addEventListener("mouseleave", () => {
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
                if (ui.in_mode(UIState.Connect)) {
                    // Connect two cells if the source is different to the target.
                    if (ui.state.target === this) {
                        ui.state.connect(ui);
                    }
                    // Focus the label input for a cell if we've just ended releasing
                    // the mouse on top of the source. (This includes when we've
                    // dragged the cursor, rather than just having clicked, but this
                    // tends to work as expected).
                    if (ui.state.source === this && was_previously_selected) {
                        ui.panel.element.querySelector('label input[type="text"]').focus();
                    }
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

    select() {
        this.element.classList.add("selected");
    }

    deselect() {
        this.element.classList.remove("selected");
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

    /// Create the HTML element associated with the vertex.
    render(ui) {
        const offset = ui.offset_from_position(this.position);

        const construct = this.element === null;

        // The container for the cell.
        if (construct) {
            this.element = new DOM.Element("div").element;
        }
        offset.reposition(this.element);
        if (!construct) {
            // If the element already existed, then as soon as we've moved it to the correct
            // position, nothing remains to be done.
            return;
        }

        this.element.classList.add("vertex");

        // The cell content (containing the label).
        this.element.appendChild(
            new DOM.Element("div", {
                class: "content",
            })
            // The label.
            .add(new DOM.Element(ui.render_tex(this.label), { class: "label" }))
            // Create an empty label buffer for flicker-free rendering.
            .add(new DOM.Element(ui.render_tex(), { class: "label buffer" }))
            .element
        );
    }
}

/// k-cells (for k > 0), or edges. This is primarily specialised in its set up of HTML elements.
class Edge extends Cell {
    constructor(ui, label = "", source, target, options) {
        super(ui.quiver, Math.max(source.level, target.level) + 1, label);

        this.source = source;
        this.target = target;
        ui.quiver.connect(this.source, this.target, this);

        this.options = this.default_options(options);

        this.render(ui);
        super.initialise(ui);
    }

    /// A set of defaults for edge options: a basic arrow (→).
    default_options(override_properties, override_style) {
        return Object.assign({
            label_alignment: "left",
            offset: 0,
            style: Object.assign({
                name: "arrow",
                tail: { name: "none" },
                body: { name: "cell", level: this.level },
                head: { name: "arrowhead" },
            }, override_style),
        }, override_properties);
    }

    /// Create the HTML element associated with the edge.
    render(ui) {
        let svg = null;

        if (this.element !== null) {
            // If an element already exists for the edge, then can mostly reuse it when
            // re-rendering it.
            svg = this.element.querySelector("svg");

            // Clear the SVG: we're going to be completely redrawing it. We're going to keep around
            // any definitions, though, as we can effectively reuse them.
            for (const child of Array.from(svg.childNodes)) {
                if (child.tagName !== "defs") {
                    child.remove();
                }
            }
        } else {
            // The container for the edge.
            this.element = new DOM.Element("div", { class: "edge" }).element;

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
                { width: "100%", height: "100%"},
                { fill: "white" },
            ));
            mask.add(
                new DOM.SVGElement("rect", { class: "clear" }, { fill: "black", stroke: "none" })
            );
            defs.add(mask);
            svg.appendChild(defs.element);

            // The edge label.
            const label = ui.render_tex(this.label, () => this.update_label_transformation());
            this.element.appendChild(label);
            // Create an empty label buffer for flicker-free rendering.
            const buffer = ui.render_tex();
            buffer.classList.add("buffer");
            this.element.appendChild(buffer);
        }

        // Set the edge's position. This is important only for the cells that depend on this one,
        // so that they can be drawn between the correct positions.
        const normal = this.angle() + Math.PI / 2;
        this.position = this.source.position
            .add(this.target.position)
            .div(2)
            .add(new Position(
                Math.cos(normal) * this.options.offset * Edge.OFFSET_DISTANCE / ui.cell_size,
                Math.sin(normal) * this.options.offset * Edge.OFFSET_DISTANCE / ui.cell_size,
            ));

        // Draw the edge itself.
        this.draw_and_position_edge(
            ui,
            this.element,
            svg,
            this.level,
            this.source.position,
            this.target.position,
            this.options,
            true,
            null,
        );

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
        this.update_label_transformation();
    }

    /// Draw an edge on an existing SVG and positions it with respect to a parent `element`.
    /// Note that this does not clear the SVG beforehand.
    /// Returns the direction of the arrow.
    draw_and_position_edge(
        ui,
        element,
        svg,
        level,
        source_position,
        target_position,
        options,
        offset_from_target,
        gap,
    ) {
        // Constants for parameters of the arrow shapes.
        const SVG_PADDING = Edge.SVG_PADDING;
        const OFFSET_DISTANCE = Edge.OFFSET_DISTANCE;
        // How much (vertical) space to give around the SVG.
        const EDGE_PADDING = 4;
        // How much space to leave between the cells this edge spans. (Less for other edges.)
        let MARGIN = level === 1 ? ui.cell_size / 4 : ui.cell_size / 8;

        // The SVG for the arrow itself.
        const offset_delta = ui.offset_from_position(target_position.sub(source_position), false);
        const length = Math.hypot(offset_delta.top, offset_delta.left)
            - MARGIN * (offset_from_target ? 2 : 1);

        // If the arrow has zero or negative length, then we can just return here.
        // Otherwise we just get SVG errors from drawing invalid shapes.
        if (length <= 0) {
            // Pick an arbitrary direction to return.
            return 0;
        }

        const { dimensions, alignment } = this.draw_edge(svg, options, length, gap, true);
        // If the arrow is shorter than expected (for example, because we are using a
        // fixed-width arrow style), then we need to make sure that it's still centred
        // if the `alignment` is `"centre"`.
        const width_shortfall = length + SVG_PADDING * 2 - dimensions.width;
        let margin_adjustment;
        switch (alignment) {
            case "left":
                margin_adjustment = 0;
                break;
            case "centre":
                margin_adjustment = 0.5;
                break;
            case "right":
                margin_adjustment = 1;
                break;
        }
        const margin = MARGIN + width_shortfall * margin_adjustment;

        // Transform the `element` so that the arrow points in the correct direction.
        const direction = Math.atan2(offset_delta.top, offset_delta.left);
        const source_offset = ui.offset_from_position(source_position);
        element.style.left = `${source_offset.left + Math.cos(direction) * margin}px`;
        element.style.top = `${source_offset.top + Math.sin(direction) * margin}px`;
        [element.style.width, element.style.height]
            = new Offset(dimensions.width, dimensions.height + EDGE_PADDING * 2).to_CSS();
        element.style.transformOrigin
            = `${SVG_PADDING}px ${dimensions.height / 2 + EDGE_PADDING}px`;
        element.style.transform = `
            translate(-${SVG_PADDING}px, -${dimensions.height / 2 + EDGE_PADDING}px)
            rotate(${direction}rad)
            translateY(${(options.offset || 0) * OFFSET_DISTANCE}px)
        `;

        return direction;
    }

    /// Draws an edge on an SVG. `length` must be nonnegative.
    /// Note that this does not clear the SVG beforehand.
    /// Returns the (new) dimensions of the SVG and the intended alignment of the edge.
    /// `{ dimensions, alignment }`
    draw_edge(svg, options, length, gap, scale = false) {
        // Constants for parameters of the arrow shapes.
        const SVG_PADDING = Edge.SVG_PADDING;
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

        // The maximum number of arrowheads.
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
                }

                switch (options.style.head.name) {
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

            case "corner":
                // The dimensions of the bounding box of the ⌟ symbol.
                const SIZE = 12;
                [width, height] = [SIZE / 2 ** 0.5, SIZE * 2 ** 0.5];
                // We want to draw the symbol next to the vertex from which it is drawn.
                alignment = "left";
                break;
        }

        // Now actually draw the edge.

        switch (options.style.name) {
            case "arrow":
                if (options.style.body.name !== "none") {
                    // A function for finding the width of an arrowhead at a certain y position,
                    // so that we can draw multiple lines to a curved arrow head perfectly.
                    const x = (y) => {
                        if (head_height === 0 || options.style.head.name === "none") {
                            return 0;
                        }
                        return head_width * (1 - (1 - 2 * Math.abs(y) / head_height) ** 2) ** 0.5;
                    };

                    // Draw all the lines.
                    for (let i = 0; i < level; ++i) {
                        let y = (i + (1 - level) / 2) * SPACING;
                        // This edge case is necessary simply for very short edges.
                        if (Math.abs(y) <= head_height / 2) {
                            const path
                                = [`M ${SVG_PADDING + shorten} ${SVG_PADDING + height / 2 + y}`];
                            const line_length = length - shorten - x(y);

                            if (options.style.body.name === "squiggly") {
                                // The height of each triangle from the edge.
                                const AMPLITUDE = 2;
                                // Flat padding at the start of the edge (measured in
                                // triangles). Twice as much padding is given at the end.
                                const PADDING = 1;

                                path.push(`l ${AMPLITUDE * 2 * PADDING} 0`);
                                for (
                                    let l = AMPLITUDE * 2 * PADDING, flip = 1;
                                    l < line_length - AMPLITUDE * 4 * PADDING;
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
                const draw_arrowhead = (x, top = true, bottom = true) => {
                    svg.appendChild(new DOM.SVGElement("path", {
                        d: (top ? `
                            M ${SVG_PADDING + x} ${SVG_PADDING + height / 2}
                            a ${head_width} ${head_height / 2} 0 0 1 -${head_width}
                                -${head_height / 2}
                        ` : "") + (bottom ? `
                            M ${SVG_PADDING + x} ${SVG_PADDING + height / 2}
                            a ${head_width} ${head_height / 2} 0 0 0 -${head_width}
                                ${head_height / 2}
                        ` : "").trim().replace(/\s+/g, " ")
                    }).element);
                };

                // Draw the arrow tail.
                switch (options.style.tail.name) {
                    case "maps to":
                        svg.appendChild(new DOM.SVGElement("path", {
                            d: `
                                M ${SVG_PADDING} ${SVG_PADDING + (height - tail_height) / 2}
                                l ${0} ${tail_height}
                            `.trim().replace(/\s+/g, " ")
                        }).element);
                        break;

                    case "mono":
                        draw_arrowhead(head_width);
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
                        draw_arrowhead(width, top, !top);
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
                svg.appendChild(new DOM.SVGElement("path", {
                    d: `
                        M ${SVG_PADDING} ${SVG_PADDING}
                        l ${width} ${width}
                        l ${-width} ${width}
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
    angle() {
        return this.target.position.sub(this.source.position).angle();
    }

    /// Update the `label` transformation (translation and rotation) as well as
    /// the edge clearing size for `centre` alignment in accordance with the
    /// dimensions of the label.
    update_label_transformation() {
        const label = this.element.querySelector(".label:not(.buffer)");

        // Bound an `angle` to [0, π/2).
        const bound_angle = (angle) => {
            return Math.PI / 2 - Math.abs(Math.PI / 2 - ((angle % Math.PI) + Math.PI) % Math.PI);
        };

        const angle = this.angle();

        // How much to offset the label from the edge.
        const LABEL_OFFSET = 16;
        let label_offset;
        switch (this.options.label_alignment) {
            case "left":
                label_offset = -1;
                break;
            case "centre":
                label_offset = 0;
                break;
            case "right":
                label_offset = 1;
                break;
        }

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

    /// Reverses the edge, swapping the `source` and `target`.
    reverse(ui) {
        // Flip all the dependency relationships.
        for (const cell of ui.quiver.reverse_dependencies.get(this)) {
            const dependencies = ui.quiver.dependencies.get(cell);
            dependencies.set(this, { source: "target", target: "source" }[dependencies.get(this)]);
        }

        // Reverse the label alignment and edge offset as well as any oriented styles.
        // Note that since we do this, the position of the edge will remain the same, which means
        // we don't need to rerender any of this edge's dependencies.
        this.options.label_alignment
            = { left: "right", centre: "centre", right: "left" }[this.options.label_alignment];
        this.options.offset = -this.options.offset;
        if (this.options.style.name === "arrow" && this.options.style.head.name === "harpoon") {
            this.options.style.head.side
                = { top: "bottom", bottom: "top" }[this.options.style.head.side];
        }

        // Swap the `source` and `target`.
        [this.source, this.target] = [this.target, this.source];

        this.render(ui);
    }
}
// The following are constant shared between multiple methods, so we store them in the
// class variables for `Edge`.
// How much (horizontal and vertical) space in the SVG to give around the arrow
// (to account for artefacts around the drawing).
Edge.SVG_PADDING = 6;
// How much space to leave between adjacent parallel arrows.
Edge.OFFSET_DISTANCE = 8;

// Initialise MathJax.
window.MathJax = {
  jax: ["input/TeX", "output/SVG"],
  extensions: ["tex2jax.js", "TeX/noErrors.js"],
  messageStyle: "none",
  skipStartupTypeset: true,
  positionToHash: false,
  showMathMenu: false,
  showMathMenuMSIE: false,
  TeX: {
    noErrors: {
        multiLine: false,
        style: {
            color: "hsl(0, 100%, 40%)",
            font: "18px monospace",
            border: "none",
        },
    }
  },
};

// We want until the (minimal) DOM content has loaded, so we have access to `document.body`.
document.addEventListener("DOMContentLoaded", () => {
    /// The global UI.
    let ui = new UI(document.body);
    ui.initialise();
});
