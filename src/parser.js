/// This is a simple recursive descent parser for tikz-cd diagrams. The intention is to be able to
/// parse those diagrams exported by quiver, in addition to a handful of other tikz-cd features that
/// are commonly used in hand-written diagrams. Most of the implementation is dealing with errors
/// nicely, e.g. issuing informative diagnostics. Note that we do not try to guarantee that
/// exporting from quiver, then parsing the resulting tikz-cd will result in exactly the same
/// diagram (though this is certainly something we would like to aim for): some of the techniques we
/// use are heuristic-based (e.g. calculating lengths), and guaranteeing a perfect round-trip is not
/// feasible.
class Parser {
    constructor(ui, code) {
        this.ui = ui;
        // `souce` is not changed.
        this.source = code;
        // `code` is changed as the parse proceeds: it is the remaining source to parse.
        this.code = code;
        // A list of errors and warnings to issue once the parse has concluded.
        this.diagnostics = [];
        // A map from cell names to cells.
        this.cells = new Map();
        // The current position to place new vertices.
        this.x = 0;
        this.y = 0;
        // The string used to demark a new column. This may be changed by `ampersand replacement`.
        this.col_delim = "&";
    }

    /// The current position of the parser in the `source` code.
    get position() {
        return this.source.length - this.code.length;
    }

    /// Returns a range starting from the specified position, to the currrent position.
    range_from(start) {
        return Parser.Range.from_to(start, this.position);
    }

    /// Returns a zero-width range at the current position. This is the default range when we don't
    /// have better information about the range to associate with a diagnostic.
    range_here() {
        return this.range_from(this.position);
    }

    log(diagnostic) {
        this.diagnostics.push(diagnostic);
    }

    // We use errors to exit early out of parsing at different stages. Any time an error or warning
    // is caught, it is logged, and parsing resumes, if possible, after moving on to the next
    // parseable segment.
    // Every occurrence of `this.error` or `this.warn` should either be `this.log`ged, or thrown.
    catch_and_log(f, on_error = () => {}) {
        try {
            f.apply(this);
        } catch (diagnostic) {
            if (diagnostic instanceof Parser.Error || diagnostic instanceof Parser.Warning) {
                on_error.apply(this, [diagnostic]);
                this.log(diagnostic);
            } else {
                // If we actually encounter a JavaScript error, we wish to log this in the console,
                // not in the UI.
                throw diagnostic;
            }
        }
    }

    error(message, range = this.range_here()) {
        return new Parser.Error(message, range);
    }

    warn(message, range = this.range_here()) {
        return new Parser.Warning(message, range);
    }

    /// Returns whether the parser has reached the end of the source.
    is_finished() {
        return this.code.length === 0;
    }

    /// The entrypoint for the parsing routine. Parses a tikz-cd diagram.
    parse_diagram() {
        this.catch_and_log(() => {
            this.eat_whitespace_and_comments();
            const in_block = this.eat("\\[") !== null;
            this.eat_whitespace_and_comments();
            if (!this.eat("\\begin{tikzcd}")) {
                throw this.error(
                    ["Diagrams must start with ", new DOM.Code("\\begin{tikzcd}"), "."],
                    new Parser.Range(0, this.code.length),
                );
            }
            this.catch_and_log(this.parse_diagram_options);
            const parser_edges = [];

            // A loop to parse cells (edges and nodes).
            let [x, y] = [null, null];
            while (true) {
                this.eat_whitespace_and_comments();
                let leaf;
                if ((leaf = this.parse_edge()) !== null) {
                    parser_edges.push(leaf);
                    continue;
                }
                if (this.eat(this.col_delim)) {
                    ++this.x;
                    continue;
                }
                if (this.eat("\\\\")) {
                    this.x = 0;
                    ++this.y;
                    continue;
                }
                let cont = false;
                const position = this.position;
                // Nodes must be parsed last, because they are greedy about what they consider to be
                // an acceptable label, and so may parse an arrow as a node, for instance.
                this.catch_and_log(() => {
                    if ((leaf = this.parse_node()) !== null) {
                        cont = true;
                        if (this.x === x && this.y === y) {
                            // If we haven't moved to a new position since the last node, throw an
                            // error.
                            throw this.error([
                                "Expected ", new DOM.Code(this.col_delim),
                                " or ", new DOM.Code("\\\\"), " between nodes."
                            ], new Parser.Range(position, 0));
                        }
                        x = this.x, y = this.y;
                        this.cells.set(`${leaf.position}`, leaf);
                        this.ui.quiver.add(leaf);
                    }
                }, () => cont = true);
                if (!cont) {
                    break;
                }
            }
            // quiver lays out non-edge aligned connections using phantom edges. These should not be
            // treated as real edges that are rendered in quiver.
            const phantoms = new Set();
            const adjust_for_phantoms = (edge, end) => {
                if (/^[0-9]+p$/.test(edge[end])) {
                    const non_phantom = edge[end].slice(0, -1);
                    if (this.cells.get(edge[end]).phantom && this.cells.has(non_phantom)) {
                        phantoms.add(this.cells.get(edge[end]));
                        edge.options.edge_alignment[end] = false;
                        return non_phantom;
                    }
                }
                return edge[end];
            };
            const edges = new Map();
            for (const edge of parser_edges) {
                // If the edge has invalid source or target, simply skip it, as a warning will
                // already have been issued.
                if (edge.source === null || edge.target === null) {
                    continue;
                }

                const source = adjust_for_phantoms(edge, "source");
                const target = adjust_for_phantoms(edge, "target");

                // Create dummy vertices if there are none in place for the source/target.
                if (!this.cells.has(`${source}`)) {
                    this.cells.set(`${source}`, new Vertex(this.ui, "", source));
                }
                // If the target is undefined, it was never set (as opposed to being set to an
                // invalid value).
                if (typeof target === "undefined") {
                    this.log(this.error("Encountered arrow with no target.", edge.range));
                    continue;
                }
                if (`${target}` === `${source}`) {
                    this.log(
                        this.error("Encountered arrow with the same source and target.", edge.range)
                    );
                    continue;
                }
                if (!this.cells.has(`${target}`)) {
                    this.cells.set(`${target}`, new Vertex(this.ui, "", target));
                }
                let source_cell = this.cells.get(`${source}`);
                if (source_cell instanceof Parser.Edge) {
                    source_cell = edges.get(source_cell);
                }
                let target_cell = this.cells.get(`${target}`);
                if (target_cell instanceof Parser.Edge) {
                    target_cell = edges.get(target_cell);
                }
                edges.set(edge, new Edge(
                    this.ui, edge.label, source_cell, target_cell, edge.options, edge.label_colour
                ));
            }
            // Remove any phantom edges. Currently, we only remove those edges that were confirmed
            // to be those exported by quiver for a special purpose, not any edge with the `phantom`
            // attribute.
            for (const phantom of phantoms) {
                this.ui.remove_cell(edges.get(phantom), this.ui.present);
            }
            this.ui.quiver.flush(this.ui.present);

            // Update all the affected columns and rows.
            delay(() => {
                // After updating the grid, we shorten the arrows proportionally to their
                // length.
                for (const [parser_edge, edge] of edges) {
                    try {
                        // This multiplier is lifted from `QuiverImportExport.tikz_cd`.
                        const multiplier = QuiverExport.CONSTANTS.TIKZ_HORIZONTAL_MULTIPLIER
                        * QuiverExport.CONSTANTS.TIKZ_VERTICAL_MULTIPLIER
                        / ((QuiverExport.CONSTANTS.TIKZ_HORIZONTAL_MULTIPLIER ** 2
                                * Math.sin(edge.angle()) ** 2
                        + QuiverExport.CONSTANTS.TIKZ_VERTICAL_MULTIPLIER ** 2
                            * Math.cos(edge.angle()) ** 2) ** 0.5);

                        const bezier = edge.arrow.bezier();
                        const [start, end] = edge.arrow.find_endpoints();
                        const arc_length = bezier.arc_length(end.t) - bezier.arc_length(start.t);
                        const convert_length = (length) => {
                            const ROUND_TO = 5;
                            return clamp(0, Math.round(
                                (length / (arc_length * multiplier) * 100) / ROUND_TO
                            ) * ROUND_TO, 100);
                        };

                        edge.options.shorten.source = convert_length(parser_edge.shorten.source);
                        edge.options.shorten.target = convert_length(parser_edge.shorten.target);
                        if (edge.options.shorten.source + edge.options.shorten.target >= 100) {
                            this.log(
                                this.warn("Encountered arrow with zero length.", parser_edge.range)
                            );
                            // Reset the shortening.
                            edge.options.shorten.source = 0;
                            edge.options.shorten.target = 0;
                        }
                    } catch (_) {
                        // If there's an error, we simply don't shorten.
                    }
                }
            });

            if (!this.eat("\\end{tikzcd}")) {
                throw this.error(
                    ["Diagrams must end with ", new DOM.Code("\\end{tikzcd}"), "."],
                    new Parser.Range(0, this.source.length),
                );
            }
            this.eat_whitespace_and_comments();
            if (in_block) {
                this.eat("\\]", true);
            }
            this.eat_whitespace_and_comments();
            if (!this.is_finished()) {
                throw this.error(
                    "Unexpected content after diagram.",
                    Parser.Range.from_to(this.position, this.source.length),
                );
            }
        });
    }

    /// Eats a string or regex.
    eat(pattern, expected = false) {
        if (typeof pattern === "string") {
            if (this.code.startsWith(pattern)) {
                this.code = this.code.replace(pattern, "");
                return pattern;
            }
        } else {
            const match = this.code.match(pattern);
            if (match !== null && match.index === 0) {
                this.code = this.code.replace(pattern, "");
                return match[0];
            }
        }
        if (expected) {
            throw this.error(["Expected ", new DOM.Code(pattern), "."]);
        }
        return null;
    }

    /// Checks whether a string or pattern is next in the source.
    check(pattern) {
        if (typeof pattern === "string") {
            if (this.code.startsWith(pattern)) {
                return true;
            }
        } else {
            const match = this.code.match(pattern);
            return match !== null && match.index === 0;
        }
    }

    eat_whitespace() {
        if (/^\s+/.test(this.code)) {
            this.code = this.code.replace(/^\s+/, "");
            return true;
        }
        return false;
    }

    eat_whitespace_and_comments() {
        while (this.eat_whitespace() || this.parse_comment() !== null);
    }

    parse_nat(expected = false) {
        if (/^[0-9+]/.test(this.code)) {
            const nat = this.code.match(/^[0-9]+/)[0];
            this.code = this.code.replace(/^[0-9]+/, "");
            return parseInt(nat);
        }
        if (expected) {
            throw this.error("Expected natural number.");
        }
        return null;
    }

    parse_int(expected = false) {
        const negative = this.eat("-") !== null;
        const nat = this.parse_nat();
        if (nat !== null) {
            return negative ? -nat : nat;
        }
        if (expected) {
            throw this.error("Expected integer.");
        }
        return null;
    }

    parse_float(expected = false) {
        const start = this.position;
        const str = this.eat(/-?[0-9]*\.?[0-9]*/);
        if (str === null) {
            if (expected) {
                throw this.error("Expected number.");
            }
            return null;
        }
        const float = parseFloat(str);
        if (Number.isNaN(float)) {
            throw this.error(
                ["Expected number, found ", new DOM.Code(str), "."],
                this.range_from(start),
            );
        }
        return float;
    }

    parse_comment() {
        if (/^%/.test(this.code)) {
            const comment = this.code.match(/^%(.*)/)[1];
            this.code = this.code.replace(/^%(.*)/, "");
            return comment;
        }
        return null;
    }

    /// Issue a warning if there was an option that was not recognised, or if there were no more
    /// options.
    unknown_option_warning(regex, kind) {
        const match = this.code.match(regex);
        if (match !== null) {
            const option = match[0];
            const message = option.length > 0 ?
                [`Unknown ${kind} option: `, new DOM.Code(option), "."] :
                `Expected ${kind} option.`;
            throw this.warn(
                message,
                new Parser.Range(this.position, match[0].length),
            );
        } else {
            throw this.error(`Unexpected end of ${kind} options.`);
        }
    }

    /// Parse the options in the square brackets in `\begin{tikzcd}[...]`.
    parse_diagram_options() {
        if (this.eat("[")) {
            this.eat_whitespace();
            if (!this.eat("]")) {
                while (true) {
                    this.catch_and_log(() => {
                        this.parse_diagram_option();
                    }, this.skip_to_comma_or_bracket(/^\}/));
                    this.eat_whitespace();
                    if (this.eat("]")) {
                        break;
                    }
                    if (!this.eat(",")) {
                        if (!this.is_finished()) {
                            throw this.error(
                                "Expected comma before the start of the next diagram option."
                            );
                        }
                        break;
                    }
                    this.eat_whitespace();
                }
            }
            return true;
        }
        return false;
    }

    parse_diagram_option() {
        if (this.eat("ampersand replacement")) {
            this.eat_whitespace();
            this.eat("=", true);
            const col_delim = this.eat(/[^\s,\]]+/);
            if (col_delim !== null) {
                this.col_delim = col_delim;
            } else {
                throw this.error("Expected column delimiter.");
            }
            return;
        }
        if (this.eat("row sep") || this.eat("column sep") || this.eat("sep")) {
            // We simply ignore these options.
            this.eat_whitespace();
            this.eat("=", true);
            if (this.eat(/-?[0-9a-z\.]+/) === null) {
                throw this.error("Expected separation amount.");
            }
            return;
        }
        if (this.eat("cramped")) {
            // We simply ignore this option.
            return;
        }

        // Throw a warning about an unknown option.
        this.unknown_option_warning(/^[^,\]]*(?=[,\]])/, "diagram");
    }

    parse_name(expected) {
        const name = this.eat(/[0-9a-z_\-]+/i);
        if (name === null && expected) {
            throw this.error("Expected name.");
        }
        return name;
    }

    parse_colour(expected = false) {
        const start = this.position;
        if (this.eat("{rgb,")) {
            const s = this.parse_nat(true);
            this.eat(":red,", true);
            const r = this.parse_nat(true);
            this.eat(";green,", true);
            const g = this.parse_nat(true);
            this.eat(";blue,", true);
            const b = this.parse_nat(true);
            this.eat("}", true);
            if (s !== 255 || ![r, g, b].every((x) => x !== null && x >= 0 & x <= 255)) {
                throw this.warn("Malformed colour specification.", this.range_from(start));
            }
            return Colour.from_rgba(r, g, b);
        }
        if (expected) {
            throw this.error("Expected colour specification.");
        }
        return null;
    }

    parse_node() {
        const start = this.position;
        // We don't want to parse `\end{tikzcd}` as a node.
        if (this.check("\\end")) {
            return null;
        }
        let colour = null;
        this.catch_and_log(() => {
            if (this.eat("\\textcolor")) {
                colour = this.parse_colour(true);
            }
        });
        let label = null;
        if (this.eat("{")) {
            let brackets = 1;
            let i;
            for (i = 0; i <= this.code.length; ++i) {
                if (this.code[i] === "{") {
                    ++brackets;
                }
                if (this.code[i] === "}") {
                    --brackets;
                }
                if (brackets === 0) {
                    break;
                }
            }
            if (brackets === 0) {
                label = this.code.substr(0, i);
                this.code = this.code.slice(i + 1);
            }
        } else if (/^\S+/.test(this.code)) {
            label = this.code.match(/^\S+/)[0];
            this.code = this.code.replace(/^\S+/, "");
        }
        if (label !== null) {
            return new Vertex(
                this.ui,
                label,
                new Position(this.x, this.y),
                colour || Colour.black(),
            );
        }
        if (colour !== null) {
            throw this.error("Colour specification without node.", this.range_from(start));
        }
        return null;
    }

    /// Skip to the next option, ignoring any characters from the current position to then. Used for
    /// error recovery.
    skip_to_comma_or_bracket(brackets = null) {
        return (diagnostic = null) => {
            const start = this.position;
            this.code = this.code.replace(/^[^,\]\}]*(?=[,\]\}])/, "");
            const range = this.range_from(start);
            if (brackets !== null) {
                this.code = this.code.replace(brackets, "");
            }
            if (diagnostic !== null && diagnostic.range !== null) {
                diagnostic.range = Parser.Range.from_to(diagnostic.range.start, range.end);
            }
            return range;
        };
    }

    parse_edge() {
        const start = this.position;
        if (this.eat("\\ar")) {
            this.eat("row");
            this.eat("[", true);
            const edge = new Parser.Edge(
                new Position(this.x, this.y),
                new Parser.Range(start, start),
            );
            this.eat_whitespace();
            if (!this.eat("]")) {
                while (true) {
                    this.catch_and_log(() => {
                        this.parse_edge_option(edge);
                    }, this.skip_to_comma_or_bracket(/^\}/));
                    this.eat_whitespace();
                    if (this.eat("]")) {
                        break;
                    }
                    if (!this.eat(",")) {
                        if (!this.is_finished()) {
                            throw this.error(
                                "Expected comma before the start of the next arrow option."
                            );
                        }
                        break;
                    }
                    this.eat_whitespace();
                }
            }
            edge.range.length = this.position - edge.range.start;
            return edge;
        }
        return null;
    }

    /// Parse the options in the square brackets in `\arrow[...]`.
    parse_edge_option(edge) {
        let start = this.position;
        // We special case adjunctions, pullbacks, and barred arrows, since quiver encodes them in a
        // certain way.
        if (this.eat("\"\\dashv\"{anchor=center")) {
            this.eat(/, rotate=-?\d+/);
            this.eat("}", true);
            edge.options.style.name = "adjunction";
            return;
        }
        if (this.eat("\"\\lrcorner\"{anchor=center, pos=0.125")) {
            this.eat(/, rotate=-?\d+/);
            this.eat("}", true);
            edge.options.style.name = "corner";
            return;
        }
        if (this.eat("\"\\ulcorner\"{anchor=center, pos=0.125")) {
            this.eat(/, rotate=-?\d+/);
            this.eat("}", true);
            edge.options.style.name = "corner-inverse";
            return;
        }
        if (this.eat("\"\\shortmid\"{marking}")) {
            edge.options.style.body.name = "barred";
            return;
        }
        if (this.eat("phantom")) {
            // Special behaviour for `phantom`, which is used by quiver for edge alignment.
            edge.phantom = true;
            // In case the edge is not used for a special purpose by quiver, we give sensible
            // defaults.
            edge.options.label_alignment = "centre";
            edge.options.style.head.name = "none";
            edge.options.style.body.name = "none";
            edge.options.style.tail.name = "none";
            return;
        }
        // Parse label.
        if (this.eat("\"")) {
            const label = this.eat(/[^"]*/);
            this.eat("\"", true);
            edge.label = label;
            if (this.eat("'")) {
                edge.options.label_alignment = "right";
            }
            if (this.eat("{")) {
                this.eat_whitespace();
                if (!this.eat("}")) {
                    while (true) {
                        this.catch_and_log(() => {
                            this.parse_label_option(edge);
                        }, this.skip_to_comma_or_bracket());
                        this.eat_whitespace();
                        if (this.eat("}")) {
                            break;
                        }
                        if (!this.eat(",")) {
                            if (!this.is_finished()) {
                                throw this.error(
                                    "Expected comma before the start of the next label option."
                                );
                            }
                            break;
                        }
                        this.eat_whitespace();
                    }
                }
            }
            return;
        }
        // Parse relative target positioning.
        let to;
        if ((to = this.eat(/[urld]+(?=\s*[,\]])/))) {
            const u = (to.match(/u/g) || []).length;
            const r = (to.match(/r/g) || []).length;
            const l = (to.match(/l/g) || []).length;
            const d = (to.match(/d/g) || []).length;
            edge.target = new Position(edge.source.x + r - l, edge.source.y + d - u);
            return;
        }
        const parse_coord = () => {
            this.eat_whitespace();
            this.eat("=", true);
            this.eat_whitespace();
            if (/^[0-9]+-[0-9]+/.test(this.code)) {
                const y = this.parse_int(true);
                this.eat("-");
                const x = this.parse_int(true);
                return new Position(x - 1, y - 1);
            } else {
                start = this.position;
                let name = this.parse_name(true);
                if (!this.cells.has(name)) {
                    this.log(this.error(
                        ["No cell named ", new DOM.Code(name), "."],
                        this.range_from(start),
                    ));
                    return null;
                }
                return name;
            }
        };
        // Parse absolute source and target positioning.
        if (this.eat("from")) {
            edge.source = parse_coord();
            if (edge.source === null) {
                this.skip_to_comma_or_bracket(/^\}/)();
            }
            return;
        }
        if (this.eat("to")) {
            edge.target = parse_coord();
            if (edge.to === null) {
                this.skip_to_comma_or_bracket(/^\}/)();
            }
            return;
        }
        // quiver does not yet support loops, but it is helpful to issue an informative warning.
        if (this.eat("loop")) {
            // Do not warn about not having a target.
            edge.target = null;
            throw this.warn(
                ["Loops are not yet supported in ", new DOM.Element("b").add("quiver"), "."],
                this.range_from(start),
            );
        }
        if (this.eat("Rightarrow")) {
            edge.options.level = 2;
            return;
        }
        if (this.eat("scaling nfold")) {
            this.eat_whitespace();
            this.eat("=", true);
            this.eat_whitespace();
            const start = this.position;
            const nat = this.parse_nat(true);
            if (nat !== null) {
                edge.options.level = clamp(2, nat, CONSTANTS.MAXIMUM_CELL_LEVEL);
                if (nat < 2 || nat > CONSTANTS.MAXIMUM_CELL_LEVEL) {
                    throw this.warn(
                        `Level must be between 2 and ${CONSTANTS.MAXIMUM_CELL_LEVEL}.`,
                        this.range_from(start),
                    );
                }
            }
            return;
        }
        if (this.eat("curve")) {
            this.eat_whitespace();
            this.eat("=", true);
            this.eat_whitespace();
            this.eat("{", true);
            this.eat_whitespace();
            this.eat("height", true);
            this.eat_whitespace();
            this.eat("=", true);
            const curve = this.parse_int(true);
            this.eat("pt", true);
            this.eat_whitespace();
            this.eat("}", true);
            const factor = CONSTANTS.CURVE_HEIGHT
                * QuiverExport.CONSTANTS.TIKZ_HORIZONTAL_MULTIPLIER;
            edge.options.curve = Math.round(clamp(-5, curve / factor, 5));
            return;
        }
        let neg;
        neg = true;
        if (this.eat("bend left") || ((neg = false) || this.eat("bend right"))) {
            this.eat_whitespace();
            let amount = 1;
            if (this.eat("=")) {
                this.eat_whitespace();
                // Calculating the correct amount from the bend angle requires knowing the length of
                // the edge, which requires rendering it. Since diagrams exported from quiver do
                // not use `bend left` or `bend right`, we don't try to accurately compute the curve
                // and instead simply the presence of `bend` as an indication of whether we should
                // curve at all.
                this.parse_int(true);
            }
            edge.options.curve = Math.round(clamp(-5, amount * (neg ? -1 : 1), 5));
            return;
        }
        neg = true;
        if (this.eat("shift left") || ((neg = false) || this.eat("shift right"))) {
            this.eat_whitespace();
            let amount = 1;
            if (this.eat("=")) {
                this.eat_whitespace();
                amount = this.parse_int(true);
            }
            edge.options.offset = amount * (neg ? -1 : 1);
            return;
        }
        if (this.eat("shorten <")) {
            this.eat_whitespace();
            this.eat("=", true);
            const length = this.parse_int(true);
            edge.shorten.source = length;
            this.eat("pt", true);
            return;
        }
        if (this.eat("shorten >")) {
            this.eat_whitespace();
            this.eat("=", true);
            const length = this.parse_int(true);
            edge.shorten.target = length;
            this.eat("pt", true);
            return;
        }
        // Body styles.
        for (const style of ["dashed", "dotted", "squiggly"]) {
            if (this.eat(style)) {
                edge.options.style.body.name = style;
                return;
            }
        }
        if (this.eat("no body")) {
            edge.options.style.body.name = "none";
            return;
        }
        // Tail styles.
        if (this.eat("maps to")) {
            edge.options.style.tail.name = "maps to";
            return;
        }
        if (this.eat("tail") || this.eat("2tail")) {
            if (this.eat(" reversed")) {
                edge.options.style.tail.name = "arrowhead";
            } else {
                edge.options.style.tail.name = "mono";
            }
            return;
        }
        if (this.eat("hook")) {
            edge.options.style.tail.name = "hook";
            edge.options.style.tail.side = this.eat("'") ? "bottom" : "top";
            return;
        }
        // Head styles.
        if (this.eat("no head")) {
            edge.options.style.head.name = "none";
            return;
        }
        if (this.eat("two heads")) {
            edge.options.style.head.name = "epi";
            return;
        }
        if (this.eat("harpoon")) {
            edge.options.style.head.name = "harpoon";
            edge.options.style.head.side = this.eat("'") ? "bottom" : "top";
            return;
        }
        // Colour.
        let ate_color;
        if (this.eat("draw") || ((ate_color = true) && this.eat("color"))) {
            this.eat_whitespace();
            this.eat("=", true);
            this.eat_whitespace();
            if (!ate_color && this.eat("none")) {
                edge.options.style.head.name = "none";
                edge.options.style.body.name = "none";
                edge.options.style.tail.name = "none";
                return;
            }
            const colour = this.parse_colour(true);
            edge.options.colour = colour;
            if (ate_color) {
                edge.label_colour = colour;
            }
            return;
        }

        // The following options are deliberately ignored, because they are used by quiver in
        // tikz-cd export for convenience.
        if (this.eat("start anchor=center") || this.eat("end anchor=center")) {
            return;
        }

        // The following options are deliberately ignored, because they are used in conjunction with
        // `loop`, which we already warn about.
        if (this.eat("distance")) {
            this.eat_whitespace();
            this.eat("=", true);
            this.eat_whitespace();
            this.parse_float(true);
            this.eat(/^(em|pt)/);
            return;
        }
        if (this.eat("in") || this.eat("out")) {
            this.eat_whitespace();
            this.eat("=", true);
            this.parse_int(true);
            return;
        }

        // Throw a warning about an unknown option.
        this.unknown_option_warning(/^[^,\]]*(?=[,\]])/, "arrow");
    }

    /// Parse the options in the curly brackets in `\arrow["f"{...}]`.
    parse_label_option(edge) {
        if (this.eat("text")) {
            this.eat_whitespace();
            this.eat("=", true);
            this.eat_whitespace();
            const colour = this.parse_colour(true);
            edge.label_colour = colour;
            return;
        }
        if (this.eat("name")) {
            this.eat_whitespace();
            this.eat("=", true);
            this.eat_whitespace();
            this.cells.set(this.parse_name(true), edge);
            return;
        }
        if (this.eat("description")) {
            edge.options.label_alignment = "centre";
            return;
        }
        if (this.eat("marking")) {
            edge.options.label_alignment = "over";
            return;
        }
        if (this.eat("pos")) {
            this.eat_whitespace();
            this.eat("=", true);
            this.eat_whitespace();
            const pos = this.parse_float(true);
            edge.options.label_position = clamp(0, pos * 100, 100);
            return;
        }

        // The following options are deliberately ignored, because they are used by quiver in
        // tikz-cd export for convenience.
        if (this.eat("inner sep=0") || this.eat("anchor=center")) {
            return;
        }

        // Throw a warning about an unknown option.
        this.unknown_option_warning(/^[^,\}]*(?=[,\}])/, "label");
    }
};

/// Represents the essential information about an edge.
Parser.Edge = class {
    constructor(source, range) {
        this.source = source;
        // An undefined target is distinguished from one with `null` target. The former means that
        // the target was never set; the latter means that the target was set, but was invalid.
        this.target = undefined;
        // The range of the string specifying the edge, used for diagnostics.
        this.range = range;
        this.options = Edge.default_options({ level: 1 });
        this.label_colour = Colour.black();
        this.shorten = { source: 0, target: 0 };
        this.phantom = false;
    }
};

Parser.Error = class {
    constructor(message, range) {
        this.message = message;
        this.range = range;
    }
};

Parser.Warning = class {
    constructor(message, range) {
        this.message = message;
        this.range = range;
    }
};

/// Ranges are used for diagnostics, to highlight the part of the source that is associated with an
/// error or warning.
Parser.Range = class {
    constructor(start, length) {
        this.start = start;
        this.length = length;
    }

    get end() {
        return this.start + this.length;
    }

    static from_to(start, end) {
        return new Parser.Range(start, end - start);
    }
};
