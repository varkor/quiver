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

    get class_list() {
        return this.element.classList;
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

    /// Removes all children from the element.
    clear() {
        while (this.element.firstChild !== null) {
            this.element.firstChild.remove();
        }
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

        /// A set of cells that have been deleted. We don't properly delete cells immediately, as
        /// this makes it more awkward to revert deletion (with undo, for instance). Instead we add
        /// them to `deleted` to mark them as such and remove them *solely* from `this.cells`.
        /// Deleted cells are then ignored for all functional purposes involving dependencies.
        /// Though `deleted` is primarily treated as a set, it is really a map from cells to the
        /// point in time (e.g. history state) they were deleted at. This is so we can flush them
        /// later to avoid accumulating memory.
        this.deleted = new Map();
    }

    /// Add a new cell to the graph.
    add(cell) {
        if (!this.deleted.has(cell)) {
            this.dependencies.set(cell, new Map());
            this.reverse_dependencies.set(cell, new Set());

            while (this.cells.length <= cell.level) {
                this.cells.push(new Set());
            }
        } else {
            this.deleted.delete(cell);
        }
        this.cells[cell.level].add(cell);
    }

    /// Remove a cell from the graph.
    remove(cell, when) {
        const removed = new Set();
        const removal_queue = new Set([cell]);
        for (const cell of removal_queue) {
            if (!this.deleted.has(cell)) {
                this.deleted.set(cell, when);
                this.cells[cell.level].delete(cell);
                // The edge case here and below (`|| []`) is for when a cell and its dependencies
                // are being removed simultaneously, in which case the ordering of removal
                // here can cause problems without taking this into consideration.
                for (const [dependency,] of this.dependencies.get(cell) || []) {
                    removal_queue.add(dependency);
                }
                removed.add(cell);
            }
        }
        return removed;
    }

    /// Actually delete all deleted cells from the dependency data structures.
    flush(when) {
        for (const [cell, deleted] of this.deleted) {
            if (deleted >= when) {
                this.dependencies.delete(cell);
                for (const reverse_dependency of this.reverse_dependencies.get(cell) || []) {
                    // If a cell is being removed as a dependency, then some of its
                    // reverse dependencies may no longer exist.
                    if (this.dependencies.has(reverse_dependency)) {
                        this.dependencies.get(reverse_dependency).delete(cell);
                    }
                }
                this.reverse_dependencies.delete(cell);
                this.deleted.delete(cell);
            }
        }
    }

    /// Connect two cells. Note that this does *not* check whether the source and
    /// target are compatible with each other.
    connect(source, target, edge) {
        this.dependencies.get(source).set(edge, "source");
        this.dependencies.get(target).set(edge, "target");

        this.reverse_dependencies.get(edge).add(source);
        this.reverse_dependencies.get(edge).add(target);
    }

    /// Returns a collection of all the cells in the quiver.
    all_cells() {
        return Array.from(this.dependencies.keys()).filter(cell => !this.deleted.has(cell));
    }

    /// Returns whether the quiver is empty.
    is_empty() {
        return this.dependencies.size - this.deleted.size === 0;
    }

    /// Returns the non-deleted dependencies of a cell.
    dependencies_of(cell) {
        return new Map(Array.from(this.dependencies.get(cell)).filter(([dependency,]) => {
            return !this.deleted.has(dependency);
        }));
    }

    /// Returns the non-deleted reverse dependencies of a cell.
    reverse_dependencies_of(cell) {
        return new Set(Array.from(this.reverse_dependencies.get(cell)).filter((dependency) => {
            return !this.deleted.has(dependency);
        }));
    }

    /// Returns the transitive closure of the dependencies of a collection of cells
    // (including those cells themselves).
    transitive_dependencies(cells) {
        const closure = new Set(cells);
        // We're relying on the iteration order of the `Set` here.
        for (const cell of closure) {
            for (const [dependency,] of this.dependencies.get(cell)) {
                if (!this.deleted.has(dependency)) {
                    closure.add(dependency);
                }
            }
        }
        return closure;
    }

    /// Return a string containing the graph in a specific format.
    /// Currently, the supported formats are:
    /// - "tikzcd"
    /// - "base64"
    export(format) {
        switch (format) {
            case "tikzcd":
                return QuiverExport.tikzcd.export(this);
            case "base64":
                return QuiverImportExport.base64.export(this);
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

class QuiverImportExport extends QuiverExport {
    /// A method to import a quiver as a string. `import(export(quiver))` should be the
    /// identity function. Currently `import` takes a `UI` into which to import directly.
    import() {}
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
            if (cell.is_vertex()) {
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
                if (quiver.dependencies_of(edge).size > 0) {
                    label_parameters.push(`name=${index}`);
                    names.set(edge, index++);
                    // In this case, because we have a parameter list, we have to also change
                    // the syntax for alignment (technically, we can always use the quotation
                    // mark for swap, but it's simpler to be consistent with `description`).
                    switch (edge.options.label_alignment) {
                        case "centre":
                            label_parameters.push("description");
                            break;
                        case "over":
                            label_parameters.push("marking");
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
                        case "over":
                            // Centring without clearing is done by using the `marking` style.
                            align = " marking";
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
                let label = edge.label.trim() !== "" ? `"{${edge.label}}"${align}` : '""';

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

                            case "none":
                                parameters.push("phantom");
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

                            case "hook":
                                parameters.push(`hook${
                                    edge.options.style.tail.side === "top" ? "" : "'"
                                }`);
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
                                case "over":
                                    anchor = "marking, ";
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

QuiverImportExport.base64 = new class extends QuiverImportExport {
    // The format we use for encoding quivers in base64 (primarily for link-sharing) is
    // the following. This has been chosen based on minimality (for shorter representations),
    // rather than readability.
    //
    // Note that an empty quiver has no representation.
    //
    // `[version: integer, |vertices|: integer, ...vertices, ...edges]`
    //
    // Parameters:
    // - `version` is currently only permitted to be 0. The format has been designed to be
    //   forwards-compatible with changes, so it is intended that this version will not
    //   change.
    // - `|vertices|` is the length of the array `vertices`.
    // - `vertices` is an array of vertices of the form:
    //      `[x: integer, y: integer, label: string]`
    // - `edges` is an array of edges of the form:
    //      `[source: index, target: index, label: string, alignment, options]`
    //      + (label) `alignment` is an enum comprising the following options:
    //          * `0`: left
    //          * `1`: centre
    //          * `2`: right
    //          * `3`: over
    //        It has been distinguished from the other options as one that is frequently
    //        changed from the default, to avoid the overhead of encoding an options
    //        object.
    //      + `options` is an object containing the delta of the options from the defaults.
    //         This is the only parameter that is not encoded simply as an array, as the
    //         most likely parameter to be changed in the future.
    //
    // Notes:
    // - An `index` is an integer indexing into the array `[...vertices, ...edges]`.
    // - Arrays may be truncated if the values of the elements are the default values.

    export(quiver) {
        // Remove the query string from the current URL and use that as a base.
        const URL_prefix = window.location.href.replace(/\?.*$/, "");

        if (quiver.is_empty()) {
            // No need to have an encoding of an empty quiver;
            // we'll just use the URL directly.
            return URL_prefix;
        }

        const cells = [];
        const indices = new Map();

        let offset = new Position(Infinity, Infinity);
        // We want to ensure that the top-left cell is in position (0, 0), so we need
        // to work out where the top-left cell actually is, to compute an offset.
        for (const vertex of quiver.cells[0]) {
            offset = offset.min(vertex.position);
        }
        for (const vertex of quiver.cells[0]) {
            const { label } = vertex;
            indices.set(vertex, cells.length);
            const position = vertex.position.sub(offset).toArray();
            const cell = [...position];
            // In the name of efficiency, we omit any parameter that is not necessary.
            if (label !== "") {
                cell.push(label);
            }
            cells.push(cell);
        }

        for (let level = 1; level < quiver.cells.length; ++level) {
            for (const edge of quiver.cells[level]) {
                const { level, label, options: { label_alignment, ...options } } = edge;
                const [source, target] = [indices.get(edge.source), indices.get(edge.target)];
                indices.set(edge, cells.length);
                const cell = [source, target];
                // We want to omit parameters that are unnecessary (i.e. have the default
                // values). However, because we store parameters in an array, the only way
                // we can distinguish missing values is by the length. Therefore, we can
                // only truncate the array (not omit elements partway through the array).
                // This means we may need to include unnecessary information if there is a
                // non-default parameter after a default one. The parameters most likely to
                // be default are placed further back in the array to reduce the frequency
                // of this situation.
                const end = [];

                // We compute a delta of the edge options compared
                // to the default, so we encode a minimum of data.
                const default_options = Edge.default_options({}, {}, level);

                // Recursively compute a delta between an `object` and `base`.
                const probe = (object, base) => {
                    const delta = {};
                    for (const [key, value] of Object.entries(object)) {
                        const default_value = base[key];
                        if (typeof default_value === "object" && typeof value === "object") {
                            const subdelta = probe(value, default_value);
                            if (Object.keys(subdelta).length > 0) {
                                delta[key] = subdelta;
                            }
                        } else if (base[key] !== value) {
                            delta[key] = value;
                        }
                    }
                    return delta;
                };

                const delta = probe(options, default_options);
                if (Object.keys(delta).length > 0) {
                    end.push(delta);
                }

                const push_if_necessary = (parameter, default_value, condition = true) => {
                    if (end.length > 0 || (parameter !== default_value && condition)) {
                        end.push(parameter);
                    }
                };

                const variant = { left: 0, centre: 1, right: 2, over: 3 }[label_alignment];
                // It's only necessary to encode the label alignment is the label is not blank.
                push_if_necessary(variant, 0, label !== "");
                push_if_necessary(label, "");

                cell.push(...end.reverse());
                cells.push(cell);
            }
        }

        // The version of the base64 output format exported by this version of quiver.
        const VERSION = 0;
        const output = [VERSION, quiver.cells[0].size, ...cells];

        return `${URL_prefix}?${btoa(JSON.stringify(output))}`;
    }

    import(ui, string) {
        const quiver = new Quiver();

        let input;
        try {
            const decoded = atob(string);
            if (decoded === "") {
                return quiver;
            }
            input = JSON.parse(decoded);
        } catch (_) {
            throw new Error("invalid base64 or JSON");
        }

        // Helper functions for dealing with bad input.

        const assert = (condition, message) => {
            const postfix = " in quiver encoding";
            if (!condition) {
                throw new Error(`${message}${postfix}`);
            }
        };
        const assert_kind = (object, kind) => {
            switch (kind) {
                case "array":
                    assert(Array.isArray(object), `expected array`);
                    break;
                case "integer":
                case "natural":
                    assert(Number.isInteger(object), `expected integer`);
                    if (kind === "natural") {
                        assert(object >= 0, `expected non-negative integer`);
                    }
                    break;
                case "string":
                    assert(typeof object === "string", `expected string`);
                    break;
                case "object":
                    assert(typeof object === "object", `expected object`);
                    break;
                default:
                    throw new Error(`unknown parameter kind \`${kind}\``);
            }
        };
        const assert_eq = (object, value) => {
            assert(object === value, `expected \`${value}\`, but found \`${object}\``);
        };

        // Check all of the non-cell data is valid.
        assert_kind(input, "array");
        const [version = 0, vertices = 0, ...cells] = input;
        assert_kind(version, "natural");
        assert_eq(version, 0);
        assert_kind(vertices, "natural");
        assert(vertices <= cells.length, "invalid number of vertices");

        // We want to centre the view on the diagram, so we take the mean of all vertex positions.
        let offset = new Position(0, 0);
        // If we encounter errors while loading cells, we skip the malformed cell and try to
        // continue loading the diagram, but we want to report the errors we encountered afterwards,
        // to let the user know we were not entirely successful.
        const errors = [];

        const indices = [];
        for (const cell of cells) {
            try {
                assert_kind(cell, "array");

                if (indices.length < vertices) {
                    // This cell is a vertex.

                    assert(cell.length >= 2 && cell.length <= 3, "invalid vertex format");
                    const [x, y, label = ""] = cell;
                    assert_kind(x, "natural");
                    assert_kind(y, "natural");
                    assert_kind(label, "string");

                    const position = new Position(x, y);
                    offset = offset.add(position);
                    const vertex = new Vertex(ui, label, position);
                    indices.push(vertex);
                } else {
                    // This cell is an edge.

                    assert(cell.length >= 2 && cell.length <= 5, "invalid edge format");
                    const [source, target, label = "", alignment = 0, options = {}]
                        = cell;
                    for (const [endpoint, name] of [[source, "source"], [target, "target"]]) {
                        assert_kind(endpoint, "natural");
                        assert(endpoint < indices.length, `invalid ${name} index`);
                    }
                    assert_kind(label, "string");
                    assert_kind(alignment, "natural");
                    assert(alignment <= 3, "invalid label alignment");
                    assert_kind(options, "object");

                    // We currently don't validate `options` further than being an object.
                    // This is because it is likely that `options` will be extended in the future,
                    // and this permits a limited form of backwards compatibility. We never access
                    // prototype properties on `options`, so this should not be amenable to
                    // injection.
                    const level = Math.max(indices[source].level, indices[target].level) + 1;
                    const { style = {} } = { options };
                    delete options.style;

                    const edge = new Edge(
                        ui,
                        label,
                        indices[source],
                        indices[target],
                        Edge.default_options({
                            label_alignment: ["left", "centre", "right", "over"][alignment],
                            ...options,
                        }, style, level),
                    );
                    indices.push(edge);
                }
            } catch (error) {
                errors.push(error);
            }
        }

        // Centre the view on the quiver.
        const view_width = ui.element.offsetWidth - ui.panel.element.offsetWidth;
        ui.pan_view(
            new Offset(view_width / 2, ui.element.offsetHeight / 2)
                .sub(ui.offset_from_position(ui.view, offset.div(vertices)))
        );

        if (errors.length > 0) {
            // Just throw the first error.
            throw errors[0];
        }

        return quiver;
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

    toArray() {
        return [this.x, this.y];
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

    is_zero() {
        return this.x === 0 && this.y === 0;
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

    /// Returns an `Offset` with `{ left: 0, top: 0}`.
    static zero() {
        return new Offset(0, 0);
    }

    /// Return a [left, top] arrow of CSS length values.
    to_CSS() {
        return [`${this.left}px`, `${this.top}px`];
    }

    /// Moves an `element` to the offset.
    reposition(element) {
        [element.style.left, element.style.top] = this.to_CSS();
    }

    sub(other) {
        return new Offset(this.left - other.left, this.top - other.top);
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
UIState.Default = class extends UIState {
    constructor() {
        super();

        this.name = "default";
    }
};
UIState.default = new UIState.Default();

/// Two k-cells are being connected by an (k + 1)-cell.
UIState.Connect = class extends UIState {
    constructor(ui, source, forged_vertex) {
        super();

        this.name = "connect";

        /// The source of a connection between two cells.
        this.source = source;

        /// The target of a connection between two cells.
        this.target = null;

        /// Whether the source of this connection was created with the start
        // of the connection itself (i.e. a vertex was created after dragging
        // from an empty grid cell).
        this.forged_vertex = forged_vertex;

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
        new DOM.Element(svg).clear();
        if (!position.eq(this.source.position)) {
            Edge.draw_and_position_edge(
                ui,
                this.overlay,
                svg,
                this.source.level + 1,
                this.source.position,
                // Lock on to the target if present, otherwise simply draw the edge
                // to the position of the cursor.
                this.target !== null ? this.target.position : position,
                Edge.default_options(null, {
                    body: { name: "cell", level: this.source.level + 1 },
                }),
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
    connect(ui, event) {
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

        if (!event.shiftKey) {
            ui.deselect();
        }
        const label = "";
        // The edge itself does all the set up, such as adding itself to the page.
        const edge = new Edge(ui, label, this.source, this.target, options);
        ui.select(edge);
        if (!event.shiftKey) {
            ui.panel.element.querySelector('label input[type="text"]').focus();
        }

        return edge;
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
        for (const cell of this.selection) {
            if (!ui.positions.has(`${cell.position}`)) {
                ui.positions.set(`${cell.position}`, cell);
            } else {
                throw new Error(
                    "new cell position already contains a cell:",
                    ui.positions.get(`${cell.position}`),
                );
            }
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

        /// The size of each 0-cell.
        this.cell_size = 128;

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

        /// The offset of the view.
        this.view = Offset.zero();

        /// Undo/redo for actions.
        this.history = new History();

        /// The panel for viewing and editing cell data.
        this.panel = new Panel();

        /// What library to use for rendering labels.
        /// `null` is a basic HTML fallback: it is used until the relevant library is loaded.
        /// Options include MathJax and KaTeX.
        this.render_method = null;
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

            this.pan_view(new Offset(-event.deltaX, -event.deltaY));
        }, { passive: false });

        // Add a move to the history.
        const commit_move_event = () => {
            if (!this.state.previous.sub(this.state.origin).is_zero()) {
                // We only want to commit the move event if it actually did moved things.
                this.history.add(this, [{
                    kind: "move",
                    displacements: Array.from(this.state.selection).map((vertex) => ({
                        vertex,
                        from:
                            vertex.position.sub(this.state.previous.sub(this.state.origin)),
                        to: vertex.position,
                    })),
                }]);
            }
        };

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
                        this.history.add(this, [{
                            kind: "create",
                            cells: new Set([this.state.source]),
                        }]);
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
                    // Record the position the pointer was pressed at, so we can pan relative
                    // to that location by dragging.
                    this.state.origin = this.offset_from_event(event);
                } else {
                    if (!event.shiftKey) {
                        // Deselect cells when the mouse is pressed (at least when the Shift key
                        // is not held).
                        this.deselect();
                    } else {
                        // Otherwise, simply deselect the label input (it's unlikely the user
                        // wants to modify all the cell labels at once).
                        this.panel.element.querySelector('label input[type="text"]').blur();
                    }
                }
            }
        });

        // Handle global key presses (such as keyboard shortcuts).
        document.addEventListener("keydown", (event) => {
            // Many keyboard shortcuts are only relevant when we're not midway
            // through typing in an input, which should capture key presses.
            const editing_input = this.input_is_active();

            // Trigger a keyboard shortcut of the form Command/Control (+ Shift) + {Letter},
            // where Shift triggers the dual of the action.
            // If `effect_within_input`, then if the command is deemed to have had no effect
            // (in terms of changing the value of selection of the input), the `action`/
            // `coaction` will be triggered anyway.
            const invertible_shortcut = (action, coaction, effect_within_input = false) => {
                const effect = !event.shiftKey ? action : coaction;
                if (!editing_input) {
                    if (event.metaKey || event.ctrlKey) {
                        event.preventDefault();
                        if (this.in_mode(UIState.Default)) {
                            effect();
                        }
                    }
                } else if (effect_within_input) {
                    const input = document.activeElement;
                    const [value, selectionStart, selectionEnd]
                        = [input.value, input.selectionStart,  input.selectionEnd];
                    setTimeout(() => {
                        if (input.value === value
                            && input.selectionStart === selectionStart
                            && input.selectionEnd === selectionEnd)
                        {
                            effect();
                        }
                    }, 4);
                }
            };

            switch (event.key) {
                case "Backspace":
                case "Delete":
                    // Remove any selected cells.
                    if (!editing_input) {
                        // Prevent Backspace triggering browser history navigation.
                        event.preventDefault();

                        this.history.add(this, [{
                            kind: "delete",
                            cells: this.quiver.transitive_dependencies(this.selection),
                        }], true);
                    } else {
                        const input = document.activeElement;
                        if (document.activeElement.value === "") {
                            // Trigger the animation by (removing the class if it already exists
                            // and then) adding a class.
                            input.classList.remove("flash");
                            UI.delay(() => input.classList.add("flash"));
                        }
                    }
                    break;
                case "Enter":
                    // Focus the label input.
                    this.panel.element.querySelector('label input[type="text"]').focus();
                    break;
                case "Escape":
                    // Stop trying to connect cells.
                    if (this.in_mode(UIState.Connect)) {
                        // If we created a vertex as part of the connection, we need to record
                        // that as an action.
                        this.history.add(this, [{
                            kind: "create",
                            cells: new Set([this.state.source]),
                        }]);
                        this.switch_mode(UIState.default);
                        // If we're connecting from an insertion point, then we need to hide
                        // it again.
                        insertion_point.classList.remove("revealed");
                    }
                    // Defocus the label input.
                    this.panel.element.querySelector('label input[type="text"]').blur();
                    // Close any open panes.
                    this.panel.dismiss_export_pane(this);
                    break;
                case "Alt":
                case "Control":
                    // Holding Option triggers panning mode.
                    if (this.in_mode(UIState.Default)) {
                        this.switch_mode(new UIState.Pan(event.key));
                    }
                    break;
                // Use the arrow keys for moving vertices around.
                case "ArrowLeft":
                case "ArrowDown":
                case "ArrowRight":
                case "ArrowUp":
                    if (!editing_input) {
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
                        this.history.add(this, [{
                            kind: "move",
                            displacements: Array.from(this.selection).map((vertex) => ({
                                vertex,
                                from: vertex.position,
                                to: vertex.position.add(offset),
                            })),
                        }], true);
                    }
                    break;
                case "a":
                    // Select/deselect all.
                    invertible_shortcut(
                        () => this.select(...this.quiver.all_cells()),
                        () => this.deselect(),
                    );
                    break;
                case "z":
                    // Undo/redo
                    invertible_shortcut(
                        () => this.history.undo(this),
                        () => this.history.redo(this),
                        true,
                    );
                    break;
            }
        });

        document.addEventListener("keyup", (event) => {
            switch (event.key) {
                case "Alt":
                case "Control":
                    if (this.in_mode(UIState.Pan) && this.state.key === event.key) {
                        this.switch_mode(UIState.default);
                    }
                    break;
            }
        });

        // A helper function for creating a new vertex, as there are
        // several actions that can trigger the creation of a vertex.
        const create_vertex = (position) => {
            const label = "\\bullet";
            return new Vertex(this, label, position);
        };

        // Clicking on the insertion point reveals it,
        // after which another click adds a new node.
        insertion_point.addEventListener("mousedown", (event) => {
            if (event.button === 0) {
                if (this.in_mode(UIState.Default)) {
                    event.preventDefault();
                    if (!insertion_point.classList.contains("revealed")) {
                        // Reveal the insertion point upon a click.
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
                        // Shift when creating it.
                        if (!event.shiftKey) {
                            this.deselect();
                        }
                        const vertex = create_vertex(this.position_from_event(this.view, event));
                        this.select(vertex);
                        this.history.add(this, [{
                            kind: "create",
                            cells: new Set([vertex]),
                        }]);
                        // When the user is creating a vertex and adding it to the selection,
                        // it is unlikely they expect to edit all the labels simultaneously,
                        // so in this case we do not focus the input.
                        if (!event.shiftKey) {
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
                            = create_vertex(this.position_from_event(this.view, event));
                        // Usually this vertex will be immediately deselected, except when Shift
                        // is held, in which case we want to select the forged vertices *and* the
                        // new edge.
                        this.select(this.state.target);
                        const edge = this.state.connect(this, event);
                        const cells = new Set([this.state.target, edge]);
                        if (this.state.forged_vertex) {
                            cells.add(this.state.source);
                        }
                        this.history.add(this, [{
                            kind: "create",
                            cells: cells,
                        }]);
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
                const vertex = create_vertex(this.position_from_offset(this.view, new Offset(
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
            // Move the insertion point under the pointer.
            const position = this.position_from_event(this.view, event);
            const offset = this.offset_from_position(this.view, position);
            offset.reposition(insertion_point);

            if (this.in_mode(UIState.Pan) && this.state.origin !== null) {
                const new_offset = this.offset_from_event(event);
                this.pan_view(new_offset.sub(this.state.origin));
                this.state.origin = new_offset;
            }

            // We want to reveal the insertion point if and only if it is
            // not at the same position as an existing vertex (i.e. over an
            // empty grid cell).
            if (this.in_mode(UIState.Connect)) {
                // We only permit the forgery of vertices, not edges.
                if (this.state.source.is_vertex()) {
                    insertion_point.classList
                        .toggle("revealed", !this.positions.has(`${position}`));
                }
            }

            if (this.in_mode(UIState.Move)) {
                // Prevent dragging from selecting random elements.
                event.preventDefault();

                const new_position = (cell) => {
                    return position.add(cell.position.sub(this.state.previous));
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
                            cell.position = new_position(cell);
                            moved.add(cell);
                        }
                    }
                    this.state.previous = position;

                    // Move all of the edges connected to cells that have moved.
                    for (const cell of this.quiver.transitive_dependencies(moved)) {
                        cell.render(this);
                    }

                    // Update the panel, so that the interface is kept in sync (e.g. the
                    // rotation of the label alignment buttons).
                    this.panel.update(this);
                }
            }

            if (this.in_mode(UIState.Connect)) {
                // Prevent dragging from selecting random elements.
                event.preventDefault();

                this.state.update(this, this.position_from_event(this.view, event, false));
            }
        });

        // Set the grid background.
        this.set_background(this.canvas.element, this.view);
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

    /// A helper method for getting a position from an offset.
    position_from_offset(view, offset, round = true) {
        const transform = round ? Math.round : x => x;
        return new Position(
            transform((offset.left - view.left) / this.cell_size - 0.5),
            transform((offset.top - view.top) / this.cell_size - 0.5),
        );
    }

    /// A helper method for getting a position from an event.
    position_from_event(view, event, round = true) {
        return this.position_from_offset(view, this.offset_from_event(event), round);
    }

    /// A helper method for getting an offset from an event.
    offset_from_event(event) {
        return new Offset(event.pageX, event.pageY);
    }

    /// A helper method for getting an HTML (left, top) position from a grid `Position`.
    offset_from_position(view, position, account_for_centring = true) {
        return new Offset(
            position.x * this.cell_size + (account_for_centring ? this.cell_size / 2 : 0)
                + view.left,
            position.y * this.cell_size + (account_for_centring ? this.cell_size / 2 : 0)
                + view.top,
        );
    }

    /// A helper method to trigger a UI event immediately, but later in the event queue.
    static delay(f) {
        setTimeout(f, 0);
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
            removed.element.remove();
        }
    }

    /// Repositions the view by a relative offset.
    /// If `offset` is positive, then everything will appear to move towards the bottom right.
    pan_view(offset) {
        this.view.left += offset.left;
        this.view.top += offset.top;
        for (const cell of this.canvas.element.querySelectorAll(".cell")) {
            cell.style.left = `${cell.offsetLeft + offset.left}px`;
            cell.style.top = `${cell.offsetTop + offset.top}px`;
        }
        this.set_background(this.canvas.element, this.view);
    }

    /// Returns a unique identifier for an object.
    unique_id(object) {
        if (!this.ids.has(object)) {
            this.ids.set(object, this.ids.size);
        }
        return this.ids.get(object);
    }

    /// Returns whether the active element is a text input field. If it is, certain
    /// actions (primarily keyboard shortcuts) will be disabled.
    input_is_active() {
        return document.activeElement.matches('label input[type="text"]');
    }

    /// Renders TeX with MathJax and returns the corresponding element.
    render_tex(tex = "", after = x => x) {
        const label = new DOM.Element("div", { class: "label" });

        switch (this.render_method) {
            case null:
                label.add(tex);
                // Simulate the usual queue delay.
                UI.delay(() => after());
                break;

            case "MathJax":
                label.add(`\\(${tex}\\)`);

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
                    katex.render(tex, label.element);
                } catch (_) {
                    label.class_list.add("error");
                    label.add(tex);
                }
                // Simulate the usual queue delay.
                UI.delay(() => after());
                break;
        }

        return label;
    }

    // Set the grid background for the canvas.
    set_background(element, offset) {
        // Constants for parameters of the grid pattern.
        // The width of the cell border lines.
        const BORDER_WIDTH = 2;
        // The (average) length of the dashes making up the cell border lines.
        const DASH_LENGTH = 6;
        // The border colour.
        const BORDER_COLOUR = "lightgrey";

        // Because we're perfectionists, we want to position the dashes so that the dashes forming
        // the corners of each cell make a perfect symmetrical cross. This works out how to offset
        // the dashes to do so. Full disclosure: I derived this equation observationally and it may
        // not behave perfectly for all parameters.
        const dash_offset = (2 * (this.cell_size / 16 % (DASH_LENGTH / 2)) - 1 + DASH_LENGTH)
            % DASH_LENGTH + 1 - (DASH_LENGTH / 2);

        // We only want to set the background image if it's not already set: otherwise we
        // can update it simply by updating the position without having to reset everything.
        if (element.style.backgroundImage === "") {
            // Construct the linear gradient corresponding to the dashed pattern (in a single cell).
            let dashes = "";
            for (let x = 0; x + DASH_LENGTH * 2 < this.cell_size;) {
                dashes += `
                    transparent ${x += DASH_LENGTH}px, white ${x}px,
                    white ${x += DASH_LENGTH}px, transparent ${x}px,
                `;
            }
            // Slice off the whitespace and trailing comma.
            dashes = dashes.trim().slice(0, -1);

            const grid_background = `
                linear-gradient(${dashes}),
                linear-gradient(90deg, transparent ${this.cell_size - BORDER_WIDTH}px,
                    ${BORDER_COLOUR} 0),
                linear-gradient(90deg, ${dashes}),
                linear-gradient(transparent ${this.cell_size - BORDER_WIDTH}px, ${BORDER_COLOUR} 0)
            `.trim().replace(/\s+/g, " ");

            element.style.setProperty("--cell-size", `${this.cell_size}px`);
            element.style.backgroundImage = grid_background;
        }

        element.style.backgroundPosition = `
            ${offset.left}px ${dash_offset + offset.top}px,
            ${BORDER_WIDTH / 2 + offset.left}px ${offset.top}px,
            ${dash_offset + offset.left}px ${offset.top}px,
            ${offset.left}px ${BORDER_WIDTH / 2 + offset.top}px
        `;
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
    add(ui, actions, invoke = false) {
        // Append a new history event.
        // If there are future actions, clear them. (Our history only forms a list, not a tree.)
        ui.quiver.flush(this.present);
        this.selections.splice(this.present + 1, this.actions.length - this.present);
        this.actions.splice(this.present, this.actions.length - this.present);
        this.actions.push(actions);
        if (invoke) {
            this.redo(ui);
        } else {
            ++this.present;
        }
        this.selections.push(ui.selection);
        this.collapse = null;
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

    /// Trigger an action.
    effect(ui, actions, reverse) {
        const order = Array.from(actions);

        // We need to iterate these in reverse order if `reverse` so that interacting actions
        // get executed in the correct order relative to one another.
        if (reverse) {
            order.reverse();
        }

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
            const from = !reverse ? "from" : "to";
            const to = !reverse ? "to" : "from";
            switch (kind) {
                case "move":
                    // We perform these loops in sequence as cells may move
                    // directly into positions that have just been unoccupied.
                    const vertices = new Set();
                    for (const displacement of action.displacements) {
                        ui.positions.delete(`${displacement[from]}`);
                    }
                    for (const displacement of action.displacements) {
                        displacement.vertex.position = displacement[to];
                        ui.positions.set(
                            `${displacement.vertex.position}`,
                            displacement.vertex,
                        );
                        vertices.add(displacement.vertex);
                    }
                    for (const cell of ui.quiver.transitive_dependencies(vertices)) {
                        cell.render(ui);
                    }
                    break;
                case "create":
                    for (const cell of action.cells) {
                        ui.add_cell(cell);
                        ui.quiver.add(cell);
                    }
                    break;
                case "delete":
                    for (const cell of action.cells) {
                        ui.remove_cell(cell, this.present);
                    }
                    break;
                case "label":
                    for (const label of action.labels) {
                        label.cell.label = label[to];
                        ui.panel.render_tex(ui, label.cell);
                    }
                    ui.panel.update(ui);
                    break;
                case "label-alignment":
                    for (const alignment of action.alignments) {
                        alignment.edge.options.label_alignment = alignment[to];
                        alignment.edge.render(ui);
                    }
                    ui.panel.update(ui);
                    break;
                case "offset":
                    const edges = new Set();
                    for (const offset of action.offsets) {
                        offset.edge.options.offset = offset[to];
                        edges.add(offset.edge);
                    }
                    for (const cell of ui.quiver.transitive_dependencies(edges)) {
                        cell.render(ui);
                    }
                    ui.panel.update(ui);
                    break;
                case "reverse":
                    for (const cell of action.cells) {
                        if (cell.is_edge()) {
                            cell.reverse(ui);
                        }
                    }
                    ui.panel.update(ui);
                    break;
                case "style":
                    for (const style of action.styles) {
                        style.edge.options.style = style[to];
                        style.edge.render(ui);
                    }
                    ui.panel.update(ui);
            }
        }
    }

    undo(ui) {
        if (this.present > 0) {
            --this.present;
            this.permanentise();

            // Trigger the reverse of the previous action.
            this.effect(ui, this.actions[this.present], true);
            ui.deselect();
            ui.select(...this.selections[this.present]);
        }
    }

    redo(ui) {
        if (this.present < this.actions.length) {
            // Trigger the next action.
            this.effect(ui, this.actions[this.present], false);

            ++this.present;
            this.permanentise();
            // If we're immediately invoking `redo`, then the selection has not
            // been recorded yet, in which case the current selection is correct.
            if (this.present < this.selections.length) {
                ui.deselect();
                ui.select(...this.selections[this.present]);
            }
        }
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
            [["left",], ["centre",], ["over",], ["right",]],
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
            new DOM.Element("button", { disabled: true }).add("⇌ Reverse").listen("click", () => {
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
                ["none", { name: "none" }],
                ["maps to", { name: "maps to" }],
                ["mono", { name: "mono"} ],
                ["top-hook", { name: "hook", side: "top" }, ["short"]],
                ["bottom-hook", { name: "hook", side: "bottom" }, ["short"]],
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
                ["1-cell", { name: "cell", level: 1 }],
                ["2-cell", { name: "cell", level: 2 }],
                ["dashed", { name: "dashed" }],
                ["dotted", { name: "dotted" }],
                ["squiggly", { name: "squiggly" }],
                ["none", { name: "none" }],
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
                ["arrowhead", { name: "arrowhead" }],
                ["none", { name: "none" }],
                ["epi", { name: "epi"} ],
                ["top-harpoon", { name: "harpoon", side: "top" }, ["short"]],
                ["bottom-harpoon", { name: "harpoon", side: "bottom" }, ["short"]],
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
                ["arrow", Edge.default_options().style],
                ["adjunction", { name: "adjunction" }],
                ["corner", { name: "corner" }],
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
                    ui.element.querySelectorAll('.arrow-style input[type="radio"]:checked')
                        .forEach(element => element.dispatchEvent(new Event("change")));
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

        const display_export_pane = (format) => {
            // Handle export button interaction: export the quiver.
            // If the user clicks on two different exports in a row
            // we will simply switch the displayed export format.
            // Clicking on the same button twice closes the panel.
            if (this.export !== format) {
                // Get the base 64 URI encoding of the diagram.
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
                export_pane.clear().add(output);

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
                // The shareable link button.
                new DOM.Element("button", { class: "global" }).add("Get shareable link")
                    .listen("click", () => display_export_pane("base64"))
            ).add(
                // The export button.
                new DOM.Element("button", { class: "global" }).add("Export to LaTeX")
                    .listen("click", () => display_export_pane("tikzcd"))
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

        const create_option = (value, data) => {
            const button = new DOM.Element("input", {
                type: "radio",
                name,
                value,
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

            const { dimensions, alignment } = Edge.draw_edge(svg, options, length, gap);
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

        for (const [value, data, classes = []] of entries) {
            create_option(value, data).class_list.add(...classes);
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

        const update_label_transformation = () =>{
            if (cell.is_edge()) {
                cell.update_label_transformation();
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
                        ["Text", jax[0], cell.label],
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
                label.clear();
                try {
                    katex.render(cell.label, label.element);
                } catch (_) {
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

            // // Enable the label input if at least one cell has been selected.
            input.disabled = ui.selection.size === 0;

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
                    consider("{angle}", cell.angle());
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
        } else {
            // Disable all the inputs.
            this.element.querySelectorAll("input, button:not(.global)")
                .forEach(element => element.disabled = true);
        }
    }

    /// Dismiss the export pane, if it is shown.
    dismiss_export_pane(ui) {
        if (this.export !== null) {
            ui.element.querySelector(".export").remove();
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
                                ui.position_from_event(ui.view, event),
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
        let was_previously_selected;
        content_element.addEventListener("mousedown", (event) => {
            if (event.button === 0) {
                if (ui.in_mode(UIState.Default)) {
                    event.stopPropagation();
                    event.preventDefault();

                    was_previously_selected = !event.shiftKey && ui.selection.has(this) &&
                        // If the label input is already focused, then we defocus it.
                        // This allows the user to easily switch between editing the
                        // entire cell and the label.
                        !ui.input_is_active();

                    if (!event.shiftKey) {
                        // Deselect all other nodes.
                        ui.deselect();
                        ui.select(this);
                    } else {
                        // Toggle selection when holding Shift and clicking.
                        if (!ui.selection.has(this)) {
                            ui.select(this);
                        } else {
                            ui.deselect(this);
                        }
                    }

                    const state = new UIState.Connect(ui, this, false);
                    if (state.valid_connection(null)) {
                        ui.switch_mode(state);
                        this.element.classList.add("source");
                    }
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
                        const edge = ui.state.connect(ui, event);
                        const cells = new Set([edge]);
                        if (ui.state.forged_vertex) {
                            cells.add(ui.state.source);
                        }
                        ui.history.add(ui, [{
                            kind: "create",
                            cells,
                        }]);
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

    /// Whether this cell is an edge (i.e. whether its level is equal to zero).
    is_vertex() {
        return this.level === 0;
    }

    /// Whether this cell is an edge (i.e. whether its level is nonzero).
    is_edge() {
        return this.level > 0;
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
        const offset = ui.offset_from_position(ui.view, this.position);

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
        this.element.appendChild(new DOM.Element("div", { class: "content" }).element);
        this.render_label(ui);
    }

    /// Create the HTML element associated with the label (and label buffer).
    /// This abstraction is necessary to handle situations where MathJax cannot
    /// be loaded gracefully.
    render_label(ui) {
        const content = new DOM.Element(this.element.querySelector(".content"));
        // Remove any existing content.
        content.clear();
        // Create the label.
        content.add(ui.render_tex(this.label));
        // Create an empty label buffer for flicker-free rendering.
        const buffer = ui.render_tex(this.label);
        buffer.class_list.add("buffer");
        content.add(buffer);
    }
}

/// k-cells (for k > 0), or edges. This is primarily specialised in its set up of HTML elements.
class Edge extends Cell {
    constructor(ui, label = "", source, target, options) {
        super(ui.quiver, Math.max(source.level, target.level) + 1, label);

        this.source = source;
        this.target = target;
        ui.quiver.connect(this.source, this.target, this);

        this.options = Edge.default_options(options, null, this.level);

        this.render(ui);
        super.initialise(ui);
    }

    /// A set of defaults for edge options: a basic arrow (→).
    static default_options(override_properties, override_style, level = 1) {
        return Object.assign({
            label_alignment: "left",
            offset: 0,
            style: Object.assign({
                name: "arrow",
                tail: { name: "none" },
                body: { name: "cell", level },
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
        Edge.draw_and_position_edge(
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

    /// Create the HTML element associated with the label (and label buffer).
    /// This abstraction is necessary to handle situations where MathJax cannot
    /// be loaded gracefully.
    render_label(ui) {
        // Remove all existing labels (i.e. the label and the label buffer).
        for (const label of this.element.querySelectorAll(".label")) {
            label.remove();
        }
        // Create the edge label.
        const label = ui.render_tex(this.label, () => this.update_label_transformation());
        this.element.appendChild(label.element);
        // Create an empty label buffer for flicker-free rendering.
        const buffer = ui.render_tex();
        buffer.class_list.add("buffer");
        this.element.appendChild(buffer.element);
    }

    /// Draw an edge on an existing SVG and positions it with respect to a parent `element`.
    /// Note that this does not clear the SVG beforehand.
    /// Returns the direction of the arrow.
    static draw_and_position_edge(
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
        const offset_delta = ui.offset_from_position(
            Offset.zero(),
            target_position.sub(source_position),
            false,
        );
        const length = Math.hypot(offset_delta.top, offset_delta.left)
            - MARGIN * (offset_from_target ? 2 : 1);

        // If the arrow has zero or negative length, then we can just return here.
        // Otherwise we just get SVG errors from drawing invalid shapes.
        if (length <= 0) {
            // Pick an arbitrary direction to return.
            return 0;
        }

        const { dimensions, alignment } = Edge.draw_edge(svg, options, length, gap, true);
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
            case "over":
                margin_adjustment = 0.5;
                break;
            case "right":
                margin_adjustment = 1;
                break;
        }
        const margin = MARGIN + width_shortfall * margin_adjustment;

        // Transform the `element` so that the arrow points in the correct direction.
        const direction = Math.atan2(offset_delta.top, offset_delta.left);
        const source_offset = ui.offset_from_position(ui.view, source_position);
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
    static draw_edge(svg, options, length, gap, scale = false) {
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
                        // This edge case is necessary simply for very short edges.
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
            case "over":
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
// The following are constant shared between multiple methods, so we store them in the
// class variables for `Edge`.
// How much (horizontal and vertical) space in the SVG to give around the arrow
// (to account for artefacts around the drawing).
Edge.SVG_PADDING = 6;
// How much space to leave between adjacent parallel arrows.
Edge.OFFSET_DISTANCE = 8;

// Which library to use for rendering labels.
const RENDER_METHOD = "KaTeX";

// We want until the (minimal) DOM content has loaded, so we have access to `document.body`.
document.addEventListener("DOMContentLoaded", () => {
    // The global UI.
    let ui = new UI(document.body);
    ui.initialise();

    // A helper method for displaying error banners.
    const display_error = (message) => {
        // If there's already an error, it's not unlikely that subsequent errors will be triggered.
        // Thus, we don't display an error banner if one is already displayed.
        if (document.body.querySelector(".error-banner") === null) {
            const error = new DOM.Element("div", { class: "error-banner hidden" })
                .add(message)
                .add(
                    new DOM.Element("button", { class: "close" })
                        .listen("click", () => {
                            const SECOND = 1000;
                            error.classList.add("hidden");
                            setTimeout(() => error.remove(), 0.2 * SECOND);
                        })
                )
                .element;
            document.body.appendChild(error);
            // Animate the banner's entry.
            UI.delay(() => error.classList.remove("hidden"));
        }
    };

    const load_quiver_from_query_string = () => {
        // Get the query string (i.e. the part of the URL after the "?").
        const query_string = window.location.href.match(/\?(.*)$/);
        if (query_string !== null) {
            // If there is a query string, try to decode it as a diagram.
            try {
                QuiverImportExport.base64.import(ui, query_string[1]);
            } catch (error) {
                if (ui.quiver.is_empty()) {
                    display_error("The saved diagram was malformed and could not be loaded.");
                } else {
                    // The importer will try to recover from errors, so we may have been mostly
                    // successful.
                    display_error(
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
            display_error(`${RENDER_METHOD} failed to load.`)
        });

        // Specific, per-library behaviour.
        switch (RENDER_METHOD) {
            case "MathJax":
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
                                border: "none",
                                font: "20px monospace",
                                color: "hsl(0, 100%, 40%)",
                            },
                        }
                    },
                };
                break;
            case "KaTeX":
                document.head.appendChild(new DOM.Element("link", {
                    rel: "stylesheet",
                    href: "KaTeX/dist/katex.css",
                }).element);
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
