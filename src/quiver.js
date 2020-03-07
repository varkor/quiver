"use strict";

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
        /// That is: cells that this edge is reliant on.
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
    /// target are compatible with each other. It does handle reconnecting cells
    /// that may already be connected to other cells.
    connect(source, target, edge) {
        // Clear any existing reverse dependencies. This is necessary if we're
        // reconnecting an edge that is already connected.
        const reverse_dependencies = this.reverse_dependencies.get(edge);
        for (const cell of reverse_dependencies) {
            this.dependencies.get(cell).delete(edge);
        }
        reverse_dependencies.clear();

        this.dependencies.get(source).set(edge, "source");
        this.dependencies.get(target).set(edge, "target");

        reverse_dependencies.add(source);
        reverse_dependencies.add(target);

        // Reset the cell's level to ensure correct spacing when changing the level of the
        // source/target cells.
        const level = Math.max(source.level, target.level) + 1;
        if (this.cells.length < level + 1) {
            this.cells.push(new Set());
        }
        this.cells[edge.level].delete(edge);
        edge.level = level;
        this.cells[level].add(edge);
    }

    /// Returns a collection of all the cells in the quiver.
    all_cells() {
        return Array.from(this.dependencies.keys()).filter(cell => !this.deleted.has(cell));
    }

    /// Rerender the entire quiver. This is expensive, so should only be used when more
    /// conservative rerenderings are inappropriate (e.g. when the grid has been resized).
    rerender(ui) {
        for (const cell of this.all_cells()) {
            cell.render(ui);
        }
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
    // (including those cells themselves, unless `exclude_roots`).
    transitive_dependencies(cells, exclude_roots = false) {
        const closure = new Set(cells);
        // We're relying on the iteration order of the `Set` here.
        for (const cell of closure) {
            for (const [dependency,] of this.dependencies.get(cell)) {
                if (!this.deleted.has(dependency)) {
                    closure.add(dependency);
                }
            }
        }
        if (exclude_roots) {
            for (const cell of cells) {
                closure.delete(cell);
            }
        }
        return closure;
    }

    /// Return a string containing the graph in a specific format.
    /// Currently, the supported formats are:
    /// - "tikz-cd"
    /// - "base64"
    export(format) {
        switch (format) {
            case "tikz-cd":
                return QuiverExport.tikz_cd.export(this);
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

QuiverExport.tikz_cd = new class extends QuiverExport {
    export(quiver) {
        let output = "";

        // Wrap tikz-cd code with `\begin{tikzcd} ... \end{tikzcd}`.
        const wrap_boilerplate = (output) => {
            return `% ${QuiverImportExport.base64.export(quiver)}\n\\[\\begin{tikzcd}\n${
                output.length > 0 ? `${
                    output.split("\n").map(line => `\t${line}`).join("\n")
                }\n` : ""
            }\\end{tikzcd}\\]`;
        };

        // Early exit for empty quivers.
        if (quiver.is_empty()) {
            return wrap_boilerplate(output);
        }

        // We handle the export in two stages: vertices and edges. These are fundamentally handled
        // differently in tikz-cd, so it makes sense to separate them in this way. We have a bit of
        // flexibility in the format in which we output (e.g. edges relative to nodes, or with
        // absolute positions).
        // We choose to lay out the tikz-cd code as follows:
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
        // Iterate through the rows and columns in order, outputting the tikz-cd code.
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
            prev.y = y;
        }

        // Referencing cells is slightly complicated by the fact that we can't give vertices
        // names in tikz-cd, so we have to refer to them by position instead. That means 1-cells
        // have to be handled differently to k-cells for k > 1.
        // A map of unique identifiers for cells.
        const names = new Map();
        let index = 0;
        const cell_reference = (cell) => {
            if (cell.is_vertex()) {
                // Note that tikz-cd 1-indexes its cells.
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
                const nonempty_label = edge.label.trim();

                // We only need to give edges names if they're depended on by another edge.
                if (quiver.dependencies_of(edge).size > 0) {
                    label_parameters.push(`name=${index}`);
                    names.set(edge, index++);
                    // tikz-cd has a bug where parameters affect the edge style even the label
                    // is empty, so we only emit parameters when the label is nonempty.
                    if (nonempty_label) {
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
                    }
                } else {
                    if (nonempty_label) {
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
                }
                if (edge.options.offset !== 0) {
                    const side = edge.options.offset > 0 ? "right" : "left";
                    parameters.push(`shift ${side}=${Math.abs(edge.options.offset)}`);
                }

                let style = "";
                let label = nonempty_label !== "" ? `"{${edge.label}}"${align}` : "";

                // Edge styles.
                switch (edge.options.style.name) {
                    case "arrow":
                        // Body styles.
                        switch (edge.options.style.body.name) {
                            case "cell":
                                // tikz-cd only has supported for 1-cells and 2-cells.
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

                        let angle;

                        switch (edge.options.style.name) {
                            case "adjunction":
                                label = "\"\\dashv\"";
                                // Adjunction symbols should point in the direction of the arrow.
                                angle = -edge.angle() * 180 / Math.PI;
                                break;
                            case "corner":
                                label = "\"\\lrcorner\"";
                                label_parameters.push("very near start");
                                // Round the angle to the nearest 45º, so that the corner always
                                // appears aligned with horizontal, vertical or diagonal lines.
                                angle = 45 - 45 * Math.round(4 * edge.angle() / Math.PI);
                                break;
                        }

                        label_parameters.push(`rotate=${angle}`);

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

                // tikz-cd tends to place arrows between arrows directly contiguously
                // without adding some spacing manually.
                if (level > 1) {
                    parameters.push("shorten <=2mm");
                    parameters.push("shorten >=2mm");
                }

                output += `\\arrow[${style}` +
                    (label !== "" || label_parameters.length > 0 ? `${label || "\"\""}${
                        label_parameters.length > 0 ? `{${label_parameters.join(", ")}}` : ""
                    }, ` : "") +
                    `from=${cell_reference(edge.source)}, ` +
                    `to=${cell_reference(edge.target)}` +
                    (parameters.length > 0 ? `, ${parameters.join(", ")}` : "") +
                    "] ";
            }
            // Remove any trailing whitespace.
            output = output.trim();
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

        // We use this `unescape`-`encodeURIComponent` trick to encode non-ASCII characters.
        return `${URL_prefix}?q=${btoa(unescape(encodeURIComponent(JSON.stringify(output))))}`;
    }

    import(ui, string) {
        const quiver = new Quiver();

        let input;
        try {
            // We use this `decodeURIComponent`-`escape` trick to encode non-ASCII characters.
            const decoded = decodeURIComponent(escape(atob(string)));
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

                    const vertex = new Vertex(ui, label, new Position(x, y));
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
                    const { style = {} } = options;
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
        ui.centre_view();

        // If the quiver is now nonempty, some toolbar actions will be available.
        ui.toolbar.update(ui);

        if (errors.length > 0) {
            // Just throw the first error.
            throw errors[0];
        }

        return quiver;
    }
};
