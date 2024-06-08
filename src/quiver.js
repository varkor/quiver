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

        [edge.source, edge.target] = [source, target];

        // Reset the cell's (and its dependencies') level to ensure correct spacing when changing
        // the level of the source/target cells.
        for (const cell of this.transitive_dependencies([edge])) {
            const level = Math.max(cell.source.level, cell.target.level) + 1;
            if (this.cells.length < level + 1) {
                this.cells.push(new Set());
            }
            this.cells[cell.level].delete(cell);
            cell.level = level;
            this.cells[level].add(cell);
        }
    }

    /// Returns a collection of all the cells in the quiver.
    all_cells() {
        return Array.from(this.dependencies.keys()).filter((cell) => !this.deleted.has(cell));
    }

    /// Returns whether a cell exists in the quiver (i.e. hasn't been deleted).
    contains_cell(cell) {
        return this.all_cells().includes(cell);
    }

    /// Rerender the entire quiver. This is expensive, so should only be used when more
    /// conservative rerenderings are inappropriate (e.g. when the grid has been resized).
    rerender(ui) {
        const cells = this.all_cells();
        // Sort by level, so that the cells on which others depend are rendered first.
        cells.sort((a, b) => a.level - b.level);
        for (const cell of cells) {
            cell.render(ui);
        }
    }

    /// Returns the `[[x_min, y_min], [x_max, y_max]]` positions of the vertices in the quiver, or
    /// `null` if there are no vertices in the quiver.
    bounding_rect() {
        if (this.is_empty()) {
            return null;
        }

        const vertices = Array.from(this.cells[0]);

        const xs = vertices.map((cell) => cell.position.x);
        const ys = vertices.map((cell) => cell.position.y);

        return [
            [Math.min(...xs), Math.min(...ys)],
            [Math.max(...xs), Math.max(...ys)],
        ];
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
        let closure = new Set(cells);
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
        closure = Array.from(closure);
        closure.sort((a, b) => a.level - b.level);
        return new Set(closure);
    }

    /// Return a `{ data, metadata }` object containing the graph in a specific format.
    /// Currently, the supported formats are:
    /// - "tikz-cd"
    /// - "base64"
    /// - "html"
    /// `settings` describes persistent user settings (like whether to centre the diagram);
    /// `options` describes non-persistent user settings and diagram attributes (like the macro
    /// URL, and the dimensions of the diagram);
    /// `definitions` contains key-value pairs for macros and colours.
    export(format, settings, options, definitions) {
        switch (format) {
            case "tikz-cd":
                return QuiverImportExport.tikz_cd.export(this, settings, options, definitions);
            case "base64":
                return QuiverImportExport.base64.export(this, settings, options, definitions);
            case "html":
                return QuiverExport.html.export(this, settings, options, definitions);
            default:
                throw new Error(`unknown export format \`${format}\``);
        }
    }

    /// Return a `{ data, metadata }` object.
    /// Currently, the supported formats are:
    /// - "tikz-cd"
    /// `settings` describes persistent user settings (like whether to centre the diagram);
    import(ui, format, data, settings) {
        switch (format) {
            case "tikz-cd":
                return QuiverImportExport.tikz_cd.import(ui, data, settings);
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

/// Various methods of exporting and importing a quiver.
class QuiverImportExport extends QuiverExport {
    /// A method to import a quiver as a string. `import(export(quiver))` should be the
    /// identity function. Currently `import` takes a `UI` into which to import directly.
    import() {}

    begin_import(ui) {
        // We don't want to relayout every time we add a new cell: instead, we should perform
        // layout once, once all of the cells have been created.
        ui.buffer_updates = true;
    }

    end_import(ui) {
        // Centre the view on the quiver.
        ui.centre_view();
        // Also centre the focus point, so that it's centre of screen.
        // We subtract 0.5 from the position so that when the view is centred perfectly between
        // two cells, we prefer the top/leftmost cell.
        ui.focus_point.class_list.remove("smooth");
        ui.reposition_focus_point(ui.position_from_offset(ui.view.sub(Point.diag(0.5))));
        ui.focus_point.class_list.add("focused");
        delay(() => ui.focus_point.class_list.add("smooth"));

        // When cells are created, they are usually queued. We don't want any cells that have been
        // imported to be queued.
        for (const cell of ui.quiver.all_cells()) {
            cell.element.query_selector("kbd.queue").class_list.remove("queue");
        }

        // Update all the affected columns and rows.
        delay(() => ui.update_col_row_size(
            ...ui.quiver.all_cells()
                .filter((cell) => cell.is_vertex()).map((vertex) => vertex.position)
        ));

        // Stop buffering updates, so that individual changes to cells will resize the grid.
        ui.buffer_updates = false;

        // If the quiver is now nonempty, some toolbar actions will be available.
        ui.toolbar.update(ui);
        ui.update_focus_tooltip();
    }
}

QuiverExport.CONSTANTS = {
    // For curves and shortening, we need to try to convert proportional measurements
    // into absolute distances (in `pt`) for TikZ. There are several subtleties, one of
    // which is that the grid cell size in tikz-cd has a greater width than height, so
    // when we scale things, we need to scale differently in the horizontal and vertical
    // directions. For now, we simply multiply by constants that, heuristically, give
    // reasonable results for various diagrams I tested. It would be nice to eventually
    // correct this by using proportional lengths, but that requires a custom TikZ style
    // I do not currently possess the skills to create.
    TIKZ_HORIZONTAL_MULTIPLIER: 1/4,
    TIKZ_VERTICAL_MULTIPLIER: 1/6,
};

QuiverImportExport.tikz_cd = new class extends QuiverImportExport {
    export(quiver, settings, options, definitions) {
        let output = "";

        // Wrap tikz-cd code with `\begin{tikzcd} ... \end{tikzcd}`.
        const wrap_boilerplate = (output) => {
            const diagram_options = [];
            // Ampersand replacement.
            if (settings.get("export.ampersand_replacement")) {
                diagram_options.push("ampersand replacement=\\&");
            }
            // Cramped.
            if (settings.get("export.cramped")) {
                diagram_options.push("cramped");
            }
            // Column and row separation.
            const sep = {
                column: `${options.sep.column.toFixed(2)}em`,
                row: `${options.sep.row.toFixed(2)}em`,
            };
            const seps = {
                "0.45em": "tiny",
                "0.90em": "small",
                "1.35em": "scriptsize",
                "1.80em": "normal",
                "2.70em": "large",
                "3.60em": "huge",
            };
            for (const axis of ["column", "row"]) {
                if (seps.hasOwnProperty(sep[axis])) {
                    sep[axis] = seps[sep[axis]];
                }
            }
            if (sep.column === sep.row && sep.column !== "normal") {
                diagram_options.push(`sep=${sep.column}`);
            } else {
                for (const axis of ["column", "row"]) {
                    if (sep[axis] !== "normal") {
                        diagram_options.push(`${axis} sep=${sep[axis]}`);
                    }
                }
            }
            // `tikzcd` environment.
            let tikzcd = `\\begin{tikzcd}${
                diagram_options.length > 0 ? `[${diagram_options.join(",")}]` : ""
            }\n${
                output.length > 0 ? `${
                    output.split("\n").map(line => `\t${line}`).join("\n")
                }\n` : ""
            }\\end{tikzcd}`;
            if (settings.get("export.centre_diagram")) {
                tikzcd = `\\[${tikzcd}\\]`;
            }
            // URL.
            return `% ${
                QuiverImportExport.base64.export(quiver, settings, options, definitions).data
            }\n${tikzcd}`;
        };

        // Early exit for empty quivers.
        if (quiver.is_empty()) {
            return {
                data: wrap_boilerplate(output),
                metadata: { tikz_incompatibilities: new Set(), dependencies: new Map() },
            };
        }

        // Which symbol to use as a column separator. Usually ampersand (`&`), but sometimes it is
        // necessary to escape the ampersand when using TikZ diagrams in a nested context.
        const ampersand = settings.get("export.ampersand_replacement") ? "\\&" : "&";

        // If a label is particularly simple (containing no special symbols), we do not need to
        // surround it in curly brackets. This is preferable, because simpler output is more
        // readable. In general, we need to use curly brackets to avoid LaTeX errors. For instance,
        // `[a]` is invalid: we must use `{[a]}` instead.
        const simple_label = /^\\?[a-zA-Z0-9]+$/;

        // Adapt a label to be appropriate for TikZ output, by surrounding it in curly brackets when
        // necessary, and using `\array` for newlines.
        const format_label = (label) => {
            if (label.includes("\\\\")) {
                // The label may contain a newline. In this case, we place the label inside a table,
                // which is permitted to contain newlines.
                return `\\begin{array}{c} ${label} \\end{array}`;
            }
            if (!simple_label.test(label)) {
                return `{${label}}`;
            }
            return label;
        };

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
        for (const [y, row] of Array.from(rows).sort(([y1,], [y2,]) => y1 - y2)) {
            if (y - prev.y > 0) {
                output += ` ${"\\\\\n".repeat(y - prev.y)}`;
            }
            // This variable is really unnecessary, but it allows us to remove
            // a leading space on a line, which makes things prettier.
            let first_in_row = true;
            for (const [x, vertex] of Array.from(row).sort(([x1,], [x2,]) => x1 - x2)) {
                if (x - prev.x > 0) {
                    output += `${!first_in_row ? " " : ""}${ampersand.repeat(x - prev.x)} `;
                }
                if (vertex.label !== "" && vertex.label_colour.is_not_black()) {
                    output += `\\textcolor${
                        vertex.label_colour.latex(definitions.colours, true)}{${vertex.label}}`;
                } else {
                    output += format_label(vertex.label);
                }
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
        const cell_reference = (cell, phantom) => {
            if (cell.is_vertex()) {
                // Note that tikz-cd 1-indexes its cells.
                return `${cell.position.y - offset.y + 1}-${cell.position.x - offset.x + 1}`;
            } else {
                return `${names.get(cell)}${phantom ? "p" : ""}`;
            }
        };

        // quiver can draw more complex arrows than tikz-cd, and in some cases we are currently
        // unable to export faithfully to tikz-cd. In this case, we issue a warning to alert the
        // user that their diagram is not expected to match the quiver representation.
        const tikz_incompatibilities = new Set();
        // In some cases, we can resolve this issue by relying on another package. However, these
        // packages may not yet be standard in LaTeX installations, so we warn the issue that they
        // are required.
        const dependencies = new Map();
        const add_dependency = (dependency, reason) => {
            if (!dependencies.has(dependency)) {
                dependencies.set(dependency, new Set());
            }
            dependencies.get(dependency).add(reason);
        };

        // Output the edges.
        for (let level = 1; level < quiver.cells.length; ++level) {
            if (quiver.cells[level].size > 0) {
                output += "\n";
            }

            // Sort the edges so that we iterate through based on source (top-to-bottom,
            // left-to-right), and then target.
            const edges = [...quiver.cells[level]];
            const compare_cell_position = (a, b) => {
                if (a.position.y < b.position.y) {
                    return -1;
                }
                if (a.position.y > b.position.y) {
                    return 1;
                }
                if (a.position.x < b.position.x) {
                    return -1;
                }
                if (a.position.x > b.position.x) {
                    return 1;
                }
                return 0;
            }
            edges.sort((a, b) => {
                const find_vertex = (cell, choose) => {
                    if (cell.is_edge()) {
                        return find_vertex(choose(cell), choose);
                    }
                    return cell;
                };
                return compare_cell_position(
                    find_vertex(a, (cell) => cell.source),
                    find_vertex(b, (cell) => cell.source),
                ) || compare_cell_position(
                    find_vertex(a, (cell) => cell.target),
                    find_vertex(b, (cell) => cell.target),
                );
            });

            for (const edge of edges) {
                // The parameters pertinent to the entire arrow. TikZ is quite flexible in
                // where it allows various parameters to appear. E.g. `text` can appear in the
                // general parameter list, or as a parameter specific to a label. For specific
                // parameters, we always attach it to the label to which it is relevant. This helps
                // us avoid accidentally affecting the properties of other labels.
                const parameters = {};
                // The parameters that are inherited by phantom edges (i.e. those relating to
                // positioning, but not styling).
                const phantom_parameters = {};
                // The primary label (i.e. the one the user edits directly).
                const label = { content: edge.label };
                // A label used for the edge style, e.g. a bar, corner, or adjunction symbol.
                const decoration = {};
                // All the labels for this edge, including the primary label, a placeholder label if
                // any edges are attached to this one, and labels for non-arrow edge styles, or the
                // bar on a barred arrow.
                const labels = [label];
                // We can skip applying various properties if the edge is invisible.
                const edge_is_empty = edge.options.style.name === "arrow"
                    && edge.options.style.head.name === "none"
                    && edge.options.style.body.name === "none"
                    && edge.options.style.tail.name === "none";

                const current_index = index;
                // We only need to give edges names if they're depended on by another edge. Note
                // that we provide a name even for edges that only have non-edge-aligned edges. This
                // is not useful for the TikZ output, but is useful if the TikZ code is later parsed
                // by quiver, as it allows quiver to match phantom edges to the real edges.
                if (quiver.dependencies_of(edge).size > 0) {
                    names.set(edge, current_index);
                    // We create a placeholder label that is used as a source/target for other
                    // edges. It's more convenient to create a placeholder label so that we have
                    // fine-grained control of positioning independent of the actual label
                    // position.
                    labels.unshift({
                        name: current_index,
                        // The placeholder labels should have zero size. The following
                        // properties heuristically gave the best results for this purpose.
                        anchor: "center",
                        "inner sep": 0,
                    });
                    index++;
                }

                switch (edge.options.label_alignment) {
                    case "centre":
                        // Centring is done by using the `description` style.
                        label.description = "";
                        break;
                    case "over":
                        // Centring without clearing is done by using the `marking` style.
                        label.marking = "";
                        // If the `allow upside down` option is not specified, TikZ will flip labels
                        // when the rotation is too high.
                        label["allow upside down"] = "";
                        break;
                    case "right":
                        // By default, the label is drawn on the left side of the edge; `swap`
                        // flips the side.
                        label.swap = "";
                        break;
                }

                if (edge.options.label_position !== 50) {
                    label.pos = edge.options.label_position / 100;
                }

                if (edge.options.offset !== 0) {
                    const side = edge.options.offset > 0 ? "right" : "left";
                    const abs_offset = Math.abs(edge.options.offset);
                    parameters[`shift ${side}`] = abs_offset !== 1 ? abs_offset : "";
                    phantom_parameters[`shift ${side}`] = parameters[`shift ${side}`];
                }

                // This is the simplest case, because we can set a single attribute for both the
                // label and edge colours (which also affects the other labels, e.g. those for
                // pullbacks and adjunctions).
                if (edge.options.colour.eq(edge.label_colour) && edge.label_colour.is_not_black()) {
                    parameters.color = edge.label_colour.latex(definitions.colours);
                } else {
                    // The edge colour. An arrow is drawn only for the `arrow` style, so we don't
                    // need to emit `draw` in another case.
                    if (
                        !edge_is_empty && edge.options.colour.is_not_black()
                        && edge.options.style.name === "arrow"
                    ) {
                        parameters.draw = edge.options.colour.latex(definitions.colours);
                    }
                    // The label colour.
                    if (edge.label_colour.is_not_black()) {
                        label.text = edge.label_colour.latex(definitions.colours);
                    }
                    // The colour for non-`arrow` edges, which is drawn using a label.
                    if (edge.options.style.name !== "arrow" && edge.options.colour.is_not_black()) {
                        decoration.text = edge.options.colour.latex(definitions.colours);
                    }
                }

                // This is the calculation for the radius of an ellipse, combining the two
                // multipliers based on the angle of the edge.
                const multiplier = QuiverExport.CONSTANTS.TIKZ_HORIZONTAL_MULTIPLIER
                    * QuiverExport.CONSTANTS.TIKZ_VERTICAL_MULTIPLIER
                    / ((QuiverExport.CONSTANTS.TIKZ_HORIZONTAL_MULTIPLIER ** 2
                            * Math.sin(edge.angle()) ** 2
                    + QuiverExport.CONSTANTS.TIKZ_VERTICAL_MULTIPLIER ** 2
                        * Math.cos(edge.angle()) ** 2) ** 0.5);

                if (edge.options.curve !== 0) {
                    parameters.curve = `{height=${
                        // Using a fixed multiplier for curves of any angle tends to work better
                        // in the examples I tested.
                        edge.options.curve * CONSTANTS.CURVE_HEIGHT
                            * QuiverExport.CONSTANTS.TIKZ_HORIZONTAL_MULTIPLIER
                    }pt}`;
                    phantom_parameters.curve = parameters.curve;
                }

                // Shortened edges. This may only be set for the `arrow` style.
                const tail_is_empty = edge.options.style.name === "arrow"
                    && edge.options.style.body.name === "none"
                    && edge.options.style.tail.name === "none";
                if (!tail_is_empty && edge.options.shorten.source !== 0) {
                    const shorten = Math.round(edge.arrow.style.shorten.tail * multiplier);
                    parameters["shorten <"] = `${shorten}pt`;
                    if (edge.options.curve !== 0) {
                        // It should be possible to do this using a custom style, but for now we
                        // simply warn the user that the result will not look quite as good as it
                        // does in quiver.
                        tikz_incompatibilities.add("shortened curved arrows");
                    }
                    if (edge.target === edge.source) {
                        tikz_incompatibilities.add("shortened loops");
                    }
                }
                const head_is_empty = edge.options.style.name === "arrow"
                    && edge.options.style.head.name === "none"
                    && edge.options.style.body.name === "none";
                if (!head_is_empty && edge.options.shorten.target !== 0) {
                    const shorten = Math.round(edge.arrow.style.shorten.head * multiplier);
                    parameters["shorten >"] = `${shorten}pt`;
                    if (edge.options.curve !== 0) {
                        tikz_incompatibilities.add("shortened curved arrows");
                    }
                    if (edge.target === edge.source) {
                        tikz_incompatibilities.add("shortened loops");
                    }
                }

                // Edge styles.
                switch (edge.options.style.name) {
                    case "arrow":
                        // tikz-cd only has supported for 1-cells and 2-cells...
                        if (edge.options.level === 2 && !edge_is_empty) {
                            parameters.Rightarrow = "";
                        } else if (edge.options.level > 2) {
                            // So for n-cells for n > 2, we make use of tikz-nfold.
                            parameters.Rightarrow = "";
                            parameters["scaling nfold"] = edge.options.level;
                            add_dependency("tikz-nfold", "triple arrows or higher");
                        }

                        // We special-case arrows with no head, body, nor tail. This is because the
                        // `no body` style has some graphical issues in some versions of TikZ, so
                        // we prefer to avoid this style if possible.
                        if (edge_is_empty) {
                            parameters.draw = "none";
                            break;
                        }

                        // Body styles.
                        switch (edge.options.style.body.name) {
                            case "cell":
                                // This is the default in tikz-cd.
                                break;

                            case "dashed":
                                parameters.dashed = "";
                                break;

                            case "dotted":
                                parameters.dotted = "";
                                break;

                            case "squiggly":
                                parameters.squiggly = "";
                                break;

                            case "barred":
                                labels.push(decoration);
                                decoration.content = "\\shortmid";
                                decoration.marking = "";
                                if (edge.options.colour.is_not_black()) {
                                    decoration.text
                                        = edge.options.colour.latex(definitions.colours);
                                }
                                break;

                            case "none":
                                parameters["no body"] = "";
                                break;
                        }

                        // Tail styles.
                        switch (edge.options.style.tail.name) {
                            case "maps to":
                                parameters["maps to"] = "";
                                break;

                            case "mono":
                                switch (edge.options.level) {
                                    case 1:
                                        parameters.tail = "";
                                        break;
                                    case 2:
                                        parameters["2tail"] = "";
                                        break;
                                    default:
                                        // We've already reported an issue with triple arrows and
                                        // higher in tikz-cd, so we don't emit another one. Triple
                                        // cells are currently exported as normal arrows, so we add
                                        // the correct tail for 1-cells.
                                        parameters.tail = "";
                                        break;
                                }
                                break;

                            case "hook":
                                parameters[`hook${
                                    edge.options.style.tail.side === "top" ? "" : "'"
                                }`] = "";
                                if (edge.options.level > 1) {
                                    tikz_incompatibilities.add(
                                        "double arrows or higher with hook tails"
                                    );
                                }
                                break;

                            case "arrowhead":
                                switch (edge.options.level) {
                                    case 1:
                                        parameters["tail reversed"] = "";
                                        break;
                                    case 2:
                                        parameters["2tail reversed"] = "";
                                        break;
                                    default:
                                        // We've already reported an issue with triple arrows and
                                        // higher in tikz-cd, so we don't emit another one. Triple
                                        // cells are currently exported as normal arrows, so we add
                                        // the correct tail for 1-cells.
                                        parameters["tail reversed"] = "";
                                        break;
                                }
                                break;

                            case "none":
                                // This is the default in tikz-cd.
                                break;
                        }

                        // Head styles.
                        switch (edge.options.style.head.name) {
                            case "none":
                                parameters["no head"] = "";
                                break;

                            case "epi":
                                parameters["two heads"] = "";
                                if (edge.options.level > 1) {
                                    tikz_incompatibilities.add(
                                        "double arrows or higher with multiple heads"
                                    );
                                }
                                break;

                            case "harpoon":
                                parameters[`harpoon${
                                    edge.options.style.head.side === "top" ? "" : "'"
                                }`] = "";
                                if (edge.options.level > 1) {
                                    tikz_incompatibilities.add(
                                        "double arrows or higher with harpoon heads"
                                    );
                                }
                                break;
                        }

                        break;

                    case "adjunction":
                    case "corner":
                    case "corner-inverse":
                        labels.push(decoration);

                        parameters.draw = "none";
                        decoration.anchor = "center";

                        let angle;

                        switch (edge.options.style.name) {
                            case "adjunction":
                                decoration.content = "\\dashv";
                                // Adjunction symbols should point in the direction of the arrow.
                                angle = -Math.round(edge.angle() * 180 / Math.PI);
                                break;
                            case "corner":
                            case "corner-inverse":
                                decoration.content = edge.options.style.name.endsWith("-inverse") ?
                                    "\\ulcorner" : "\\lrcorner";
                                decoration.pos = "0.125";
                                // Round the angle to the nearest 45º, so that the corner always
                                // appears aligned with horizontal, vertical or diagonal lines.
                                angle = 45 - 45 * Math.round(4 * edge.angle() / Math.PI);
                                break;
                        }

                        if (angle !== 0) {
                            decoration.rotate = angle;
                        }

                        break;
                }

                parameters.from = cell_reference(edge.source, !edge.options.edge_alignment.source);
                parameters.to = cell_reference(edge.target, !edge.options.edge_alignment.target);

                // Loops.
                if (edge.target === edge.source) {
                    parameters.loop = "";
                    const clockwise = edge.options.radius >= 0 ? 1 : -1;
                    const loop_angle = (180 - 90 * clockwise - edge.options.angle);
                    const angle_spread = 30 + 5 * (Math.abs(edge.options.radius) - 1) / 2;
                    parameters.in = mod(loop_angle - angle_spread * clockwise, 360);
                    parameters.out = mod(loop_angle + angle_spread * clockwise, 360);
                    parameters.distance = `${5 + 5 * (Math.abs(edge.options.radius) - 1) / 2}mm`;
                }

                const object_to_list = (object) => {
                    return Object.entries(object).map(([key, value]) => {
                        return value !== "" ? `${key}=${value}` : key;
                    });
                };

                output += `\\arrow[${
                    // Ignore any labels that are empty (and aren't playing an important role as a
                    // placeholder).
                    labels.filter((label) => label.hasOwnProperty("name") || label.content !== "")
                        .map((label) => {
                            const content = label.content || "";
                            delete label.content;
                            const swap = label.hasOwnProperty("swap");
                            delete label.swap;
                            const parameters = object_to_list(label);
                            return `"${content !== "" ?
                                format_label(content) : ""}"${swap ? "'" : ""}${
                                parameters.length > 0 ? `{${parameters.join(", ")}}` : ""
                            }`;
                        })
                        .concat(object_to_list(parameters))
                        .join(", ")
                }]\n`;

                // Check whether any edges depend on this one, but are not edge aligned. In this
                // case, we have to create a phantom edge that does not depend on the labels of the
                // source and target.
                if (quiver.dependencies_of(edge).size > 0) {
                    for (const [dependency, end] of quiver.dependencies_of(edge)) {
                        if (!dependency.options.edge_alignment[end]) {
                            output += `\\arrow[""{name=${
                                current_index
                            }p, anchor=center, inner sep=0}, phantom, from=${
                                parameters.from
                            }, to=${
                                parameters.to
                            }, start anchor=center, end anchor=center${
                                Object.keys(phantom_parameters).length > 0 ?
                                    `, ${object_to_list(phantom_parameters).join(", ")}`
                                : ""
                            }]\n`;
                        }
                    }
                }
            }
            // Remove any trailing whitespace.
            output = output.trim();
        }

        return {
            data: wrap_boilerplate(output),
            metadata: { tikz_incompatibilities, dependencies },
        };
    }

    import(ui, data) {
        this.begin_import(ui);

        const parser = new Parser(ui, data);
        parser.parse_diagram();

        this.end_import(ui);

        return { diagnostics: parser.diagnostics };
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
    //      `[x: integer, y: integer, label: string, label_colour: [h, s, l, a]]`
    //      + `label` is optional (if not present, it will default to `""`), though it must be
    //         present if any later option is.
    //      + `label_colour` is optional (if not present, it will default to `[0, 0, 0, 1]`).
    //          + `h` is an integer from `0` to `360`
    //          + `s` is an integer from `0` to `100`
    //          + `l` is an integer from `0` to `100`
    //          + `a` is a floating-point number from `0` to `1`
    // - `edges` is an array of edges of the form:
    //      `[source: index, target: index, label: string, alignment, options, label_colour]`
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
    //      + `label_colour` is stored in the same manner as for vertices.
    //
    // Notes:
    // - An `index` is an integer indexing into the array `[...vertices, ...edges]`.
    // - Arrays may be truncated if the values of the elements are the default values.

    export(quiver, _, options) {
        // Remove the query string and fragment identifier from the current URL and use that as a
        // base.
        const URL_prefix = window.location.href.replace(/\?.*$/, "").replace(/#.*$/, "");

        if (quiver.is_empty()) {
            // No need to have an encoding of an empty quiver;
            // we'll just use the URL directly.
            return {
                data: URL_prefix,
                metadata: {},
            };
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
            const { label, label_colour } = vertex;
            indices.set(vertex, cells.length);
            const position = vertex.position.sub(offset).toArray();
            const cell = [...position];
            // In the name of efficiency, we omit any parameter that is not necessary, and for which
            // no later parameter is necessary.
            if (label !== "") {
                cell.push(label);
            }
            if (label !== "" && label_colour.is_not_black()) {
                // Even if the colour is not black, it's irrelevant if there is no label.
                cell.push(label_colour.hsla());
            }
            cells.push(cell);
        }

        for (let level = 1; level < quiver.cells.length; ++level) {
            for (const edge of quiver.cells[level]) {
                const { label, label_colour, options: { label_alignment, ...options } } = edge;
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

                // Even if the colour is not black, it's irrelevant if there is no label.
                if (label !== "" && label_colour.is_not_black()) {
                    end.push(label_colour.hsla());
                }

                // We compute a delta of the edge options compared
                // to the default, so we encode a minimum of data.
                const default_options = Edge.default_options({ level });

                // Recursively compute a delta between an `object` and `base`.
                const probe = (object, base) => {
                    const delta = {};
                    for (const [key, value] of Object.entries(object)) {
                        const default_value = base[key];
                        if (default_value instanceof Encodable && value instanceof Encodable) {
                            if (!default_value.eq(value)) {
                                delta[key] = value;
                            }
                        } else if (typeof default_value === "object" && typeof value === "object") {
                            const subdelta = probe(value, default_value);
                            if (Object.keys(subdelta).length > 0) {
                                delta[key] = subdelta;
                            }
                        } else if (default_value !== value) {
                            delta[key] = value;
                        }
                    }
                    return delta;
                };

                const delta = probe(options, default_options);

                // Some parameters are redundant and are used only for convenience, so we strip them
                // out.
                delete delta["shape"];
                switch (edge.options.shape) {
                    case "bezier":
                        delete delta["radius"];
                        delete delta["angle"];
                        break;
                    case "arc":
                        delete delta["curve"];
                        break;
                }

                if (end.length > 0 || Object.keys(delta).length > 0) {
                    end.push(delta);
                }

                const push_if_necessary = (parameter, default_value, condition = true) => {
                    if (end.length > 0 || (parameter !== default_value && condition)) {
                        end.push(parameter);
                    }
                };

                const variant = { left: 0, centre: 1, right: 2, over: 3 }[label_alignment];
                // It's only necessary to encode the label alignment if the label is not blank.
                push_if_necessary(variant, 0, label !== "");
                push_if_necessary(label, "");

                cell.push(...end.reverse());
                cells.push(cell);
            }
        }

        // The version of the base64 output format exported by this version of quiver.
        const VERSION = 0;
        const output = [VERSION, quiver.cells[0].size, ...cells];

        // Encode the macro URL if it's not null.
        const macro_data = options.macro_url !== null
            ? `&macro_url=${encodeURIComponent(options.macro_url)}` : "";

        const encoder = new TextEncoder();
        return {
            data: `${URL_prefix}#q=${
              btoa(String.fromCharCode(...encoder.encode(JSON.stringify(output))))
            }${macro_data}`,
            metadata: {},
        };
    }

    import(ui, string) {
        let input;
        try {
            const data = atob(string);
            const bytes = [];
            for (let i = 0; i < data.length; ++i) {
                bytes.push(data.charCodeAt(i));
            }
            const decoded = new TextDecoder().decode(new Uint8Array(bytes));
            if (decoded === "") {
                return;
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
                    assert(Array.isArray(object), "expected array");
                    break;
                case "integer":
                case "natural":
                    assert(Number.isInteger(object), "expected integer");
                    if (kind === "natural") {
                        assert(object >= 0, "expected non-negative integer");
                    }
                    break;
                case "float":
                    assert(typeof object === "number", "expected floating-point number");
                    break;
                case "boolean":
                    assert(typeof object === "boolean", "expected boolean");
                    break;
                case "string":
                    assert(typeof object === "string", "expected string");
                    break;
                case "object":
                    assert(typeof object === "object", "expected object");
                    break;
                case "colour":
                    assert_kind(object, "array");
                    assert(object.length >= 3 && object.length <= 4, "invalid colour format");
                    const [h, s, l, a = 1] = object;
                    assert_kind(h, "natural");
                    assert(h <= 360, "invalid hue");
                    assert_kind(s, "natural");
                    assert(s <= 100, "invalid saturation");
                    assert_kind(l, "natural");
                    assert(l <= 100, "invalid lightness");
                    assert_kind(a, "float");
                    assert(a >= 0 && a <= 1, "invalid alpha");
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

        this.begin_import(ui);

        const indices = [];
        for (const cell of cells) {
            try {
                assert_kind(cell, "array");

                if (indices.length < vertices) {
                    // This cell is a vertex.

                    assert(cell.length >= 2 && cell.length <= 4, "invalid vertex format");
                    const [x, y, label = "", label_colour = Colour.black().hsla()] = cell;
                    assert_kind(x, "natural");
                    assert_kind(y, "natural");
                    assert_kind(label, "string");
                    assert_kind(label_colour, "colour");

                    const vertex = new Vertex(
                        ui,
                        label,
                        new Position(x, y),
                        new Colour(...label_colour),
                    );
                    indices.push(vertex);
                } else {
                    // This cell is an edge.

                    assert(cell.length >= 2 && cell.length <= 6, "invalid edge format");
                    const [
                        source, target, label = "", alignment = 0, options = {},
                        label_colour = Colour.black().hsla()
                    ] = cell;
                    for (const [endpoint, name] of [[source, "source"], [target, "target"]]) {
                        assert_kind(endpoint, "natural");
                        assert(endpoint < indices.length, `invalid ${name} index`);
                    }
                    assert_kind(label, "string");
                    assert_kind(alignment, "natural");
                    assert(alignment <= 3, "invalid label alignment");
                    assert_kind(options, "object");
                    assert_kind(label_colour, "colour");

                    // We don't restrict the keys on `options`, because it is likely that `options`
                    // will be extended in the future, and this permits a limited form of backwards
                    // compatibility. We never access prototype properties on `options`, so this
                    // should not be amenable to injection. However, for those properties we do
                    // expect to exist, we do check they have the correct type (and in some cases,
                    // range), below.

                    let level = Math.max(indices[source].level, indices[target].level) + 1;
                    const { style = {} } = options;
                    delete options.style;

                    // Validate `options`.
                    if (options.hasOwnProperty("label_position")) {
                        assert_kind(options.label_position, "natural");
                        assert(options.label_position <= 100, "invalid label position");
                    }
                    if (options.hasOwnProperty("offset")) {
                        assert_kind(options.offset, "integer");
                    }
                    if (options.hasOwnProperty("curve")) {
                        assert_kind(options.curve, "integer");
                    }
                    if (options.hasOwnProperty("radius")) {
                        assert_kind(options.radius, "integer");
                    }
                    if (options.hasOwnProperty("angle")) {
                        assert_kind(options.angle, "integer");
                    }
                    if (options.hasOwnProperty("shorten")) {
                        let shorten = { source: 0, target: 0 };
                        if (options.shorten.hasOwnProperty("source")) {
                            assert_kind(options.shorten.source, "natural");
                            shorten.source = options.shorten.source;
                        }
                        if (options.shorten.hasOwnProperty("target")) {
                            assert_kind(options.shorten.target, "natural");
                            shorten.target = options.shorten.target;
                        }
                        assert(shorten.source + shorten.target <= 100, "invalid shorten");
                    }
                    if (options.hasOwnProperty("colour")) {
                        assert_kind(options.colour, "colour");
                        // Colour is encoded as an array, so we have to convert it to a `Colour`.
                        options.colour = new Colour(...options.colour);
                    }
                    if (options.hasOwnProperty("edge_alignment")) {
                        if (options.edge_alignment.hasOwnProperty("source")) {
                            assert_kind(options.edge_alignment.source, "boolean");
                        }
                        if (options.edge_alignment.hasOwnProperty("target")) {
                            assert_kind(options.edge_alignment.target, "boolean");
                        }
                    }

                    // In previous versions of quiver, there was a single `length` parameter, rather
                    // than two `shorten` parameters. We convert from `length` into `shorten` here.
                    if (options.hasOwnProperty("length")) {
                        assert_kind(options.length, "natural");
                        assert(options.length >= 0 && options.length <= 100, "invalid length");
                        // If both `length` and `shorten` are present (which should not happen for
                        // diagrams exported by quiver), `shorten` takes priority.
                        if (!options.hasOwnProperty("shorten")) {
                            const shorten = 100 - options.length;
                            options.shorten = { source: shorten / 2, target: shorten / 2 };
                        }
                        delete options.length;
                    }

                    // In previous versions of quiver, `level` was only valid for some arrows, and
                    // was recorded in the body style, rather than as a property of the edge itself.
                    // For backwards-compatibility, we check for this case manually here.
                    if (style.hasOwnProperty("body") && style.body.hasOwnProperty("level")) {
                        assert_kind(style.body.level, "natural");
                        assert(style.body.level >= 1, "invalid level");
                        level = style.body.level;
                        delete style.body.level;
                    }

                    const edge = new Edge(
                        ui,
                        label,
                        indices[source],
                        indices[target],
                        Edge.default_options({
                            level,
                            label_alignment: ["left", "centre", "right", "over"][alignment],
                            ...options,
                        }, style),
                        new Colour(...label_colour),
                    );
                    indices.push(edge);
                }
            } catch (error) {
                errors.push(error);
            }
        }

        this.end_import(ui);

        if (errors.length > 0) {
            // Just throw the first error.
            throw errors[0];
        }
    }
};

QuiverExport.html = new class extends QuiverExport {
    export (quiver, settings, options, definitions) {
        const url = QuiverImportExport.base64.export(quiver, settings, options, definitions).data;
        let [width, height] = settings.get("export.embed.fixed_size") ? [
            settings.get("export.embed.width"),
            settings.get("export.embed.height"),
        ] : [
            options.dimensions.width + 2 * CONSTANTS.EMBED_PADDING,
            options.dimensions.height + 2 * CONSTANTS.EMBED_PADDING,
        ];
        return {
            data: `<!-- ${url} -->
<iframe class="quiver-embed" \
src="${url}${!quiver.is_empty() ? "&" : "#"}embed" \
width="${width}" \
height="${height}" \
style="border-radius: 8px; border: none;">\
</iframe>`,
            metadata: {},
        };
    }
};
