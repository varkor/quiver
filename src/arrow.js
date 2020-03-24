"use strict";

/// `Array.prototype.includes` but for multiple needles.
function includes_any(array, ...values) {
    return !values.every((element) => !array.includes(element));
}

class QuiverSVG {
    constructor() {
        // Create a top-level SVG. This will include all the edges and labels as children.
        // Note that we need to explicitly set the namespace attribute so that the SVG can be
        // treated as a standalone file, when we want to export it.
        const xmlns = "http://www.w3.org/2000/svg";
        this.element = new DOM.SVGElement("svg", { xmlns });
    }
}

// Note that we sometimes use fractional pixel values to align drawings optimally with the pixel
// grid.
const CONSTANTS = {
    /// The space (in pixels) between each line in an n-cell. This space is the distance from the
    /// "outside" of each line: if the lines are thicker, the whitespace between them will be
    /// unaltered, so they will be pushed farther apart.
    LINE_SPACING: 4.5,
    /// The width of each line (in pixels).
    STROKE_WIDTH: 1.5,
    /// The extra padding (in pixels) of the background around an edge.
    BACKGROUND_PADDING: 16,
    /// The opacity (0 to 1) of the background.
    BACKGROUND_OPACITY: 0.2,
    /// How much padding (in pixels) to give to masks to ensure they crop sufficiently.
    MASK_PADDING: 4,
    /// How much spacing (in pixels) to leave between arrowheads of the same type.
    HEAD_SPACING: 2,
    /// How much padding (in pixels) of straight line to provide around the head/tail of a squiggly
    /// line.
    SQUIGGLY_PADDING: 8,
    /// The height (in pixels) of a single triangle of the squiggly arrow body shape.
    SQUIGGLY_TRIANGLE_HEIGHT: 2,
    /// The length of the line segments in an adjunction symbol (⊣).
    ADJUNCTION_LINE_LENGTH: 16,
    /// The length of the line segments in a corner (i.e. a pullback or pushout).
    CORNER_LINE_LENGTH: 12,
    /// The possible shapes for an edge.
    ARROW_BODY_SHAPE: new Enum(
        "ARROW_BODY_SHAPE",
        // No edge ( ).
        "NONE",
        // A line (—). This is the default.
        "LINE",
        // A squiggly line, made up of alternating triangles (⟿).
        "SQUIGGLY",
        // The adjunction symbol: ⊣.
        "ADJUNCTION",
    ),
    /// The standard dash styles for an edge.
    ARROW_DASH_STYLE: new Enum(
        "ARROW_DASH_STYLE",
        // A solid line, with no breaks (—). This is the default.
        "SOLID",
        // A dashed line (⤏).
        "DASHED",
        // A dotted line (⤑).
        "DOTTED",
    ),
    /// The different kinds of (preset) arrow heads. Technically, we are able to draw more
    /// sophisticated combinations, but these are the ones that have been tested and will be
    /// used by quiver directly.
    ARROW_HEAD_STYLE: {
        /// No arrow head (-).
        NONE: [],
        /// The usual arrow head style (→).
        NORMAL: ["epi"],
        /// A double arrow head (↠).
        EPI: ["epi", "epi"],
        /// A reversed arrow head (⤚).
        MONO: ["mono"],
        /// A perpendicular line (↦).
        MAPS_TO: ["maps to"],
        /// A harpoon: just the upper part of the arrow head (⇀).
        HARPOON_TOP: ["harpoon-top"],
        /// A harpoon: just the lower part of the arrow head (⇁).
        HARPOON_BOTTOM: ["harpoon-bottom"],
        /// A hook (↪).
        HOOK_TOP: ["hook-top"],
        /// A hook (↩).
        HOOK_BOTTOM: ["hook-bottom"],
        /// The corner of a square, used for pullbacks and pushouts.
        CORNER: ["corner"],
    }
};


class ArrowStyle {
    constructor() {
        this.body_shape = CONSTANTS.ARROW_BODY_SHAPE.LINE;
        this.dash_style = CONSTANTS.ARROW_DASH_STYLE.SOLID;
        // The "n" in "n-cell". Must be a positive integer.
        this.level = 1;
        // The height of the curve (in pixels). May be positive or negative.
        this.curve = 0;
    }
}

class Label {
    constructor(text) {
        this.text = text;
    }
}

class Arrow {
    constructor(source, target, style) {
        this.source = source;
        this.target = target;
        this.style = style;
        // The SVG containing the edge itself, including the arrow head and tail.
        this.svg = new DOM.SVGElement("svg");
        // The mask to be used for any edges having this edge as a source or target.
        this.mask = new DOM.SVGElement("svg");
        // The background to the edge, with which the user may interact.
        this.background = new DOM.SVGElement("svg");
    }

    /// The total width of the edge line itself, not including the arrowhead, tail, label or
    /// background.
    edge_width() {
        return this.style.level * CONSTANTS.STROKE_WIDTH
            + (this.style.level - 1) * CONSTANTS.LINE_SPACING;
    }

    /// Redraw the arrow, its mask, and its background. We should minimise calls to `redraw`: it
    /// should only be called if something has actually changed: for instance, its position or
    /// properties.
    redraw() {
        // Calculate some constants that are relevant for all three components of the arrow: the
        // mask, background and the arrow itself.

        // The total width of the edge line itself. This does not take into account the extra height
        // induced if the body style is squiggly (see the comment on `padding_y`).
        const edge_width = this.edge_width();

        // The width of an arrowhead, considered pointing left-to-right.
        // This was determined by experimenting with what looked nice.
        const head_width =
            (CONSTANTS.LINE_SPACING + CONSTANTS.STROKE_WIDTH) + (this.style.level - 1) * 2;

        // The height of an arrowhead, considered pointing left-to-right.
        // This was determined by experimenting with what looked nice.
        const head_height = edge_width + (CONSTANTS.LINE_SPACING + CONSTANTS.STROKE_WIDTH) * 2;

        // The horizontal padding. This accounts for the case when the edges are essentially
        // vertical (with high curves).
        const padding_x = head_height / 2 + CONSTANTS.BACKGROUND_PADDING;

        // The vertical padding. We only need to pad vertically if the arrow is squiggly, in which
        // case, there will be some oscillation around the centre line over the usual edge width.
        const padding_y = this.style.body_shape === CONSTANTS.ARROW_BODY_SHAPE.SQUIGGLY ?
            CONSTANTS.SQUIGGLY_TRIANGLE_HEIGHT + CONSTANTS.STROKE_WIDTH : 0;

        // The distance from the source to the target.
        const length = Math.hypot(this.target.y - this.source.y, this.target.x - this.source.x);

        // The vertical distance from the straight line connecting the source to the target, and the
        // peak of the curve.
        const height = Math.abs(this.style.curve) + head_height
            + (padding_y + CONSTANTS.BACKGROUND_PADDING) * 2;

        // The angle of the straight line connecting the source to the target.
        const angle = Math.atan2(this.target.y - this.source.y, this.target.x - this.source.x);

        // The width and height of the SVG for the arrow.
        const [svg_width, svg_height] = [length + padding_x * 2, height + padding_y * 2];

        // Redraw the mask.

        // Redraw the background.

        // Create a clipping mask for the background.
        const bg_defs = new DOM.SVGElement("defs").add_to(this.background);
        const bg_mask = new DOM.SVGElement("mask", {
            id: "bg-mask",
            maskUnits: "userSpaceOnUse",
        }).add_to(bg_defs);
        // By default, we draw everything.
        new DOM.SVGElement("rect", {
            width: svg_width,
            height: svg_height,
            x: -padding_x,
            y: -padding_y,
            fill: "white",
        }).add_to(bg_mask);

        // Draw the actual background.
        const bg_path = new DOM.SVGElement("path", {
            mask: "url(#bg-mask)",
            d: `${new Path().move_to(0, height / 2).curve_by(length / 2, curve, length, 0)}`,
            fill: "none",
            stroke: `hsla(0, 0%, 0%, ${CONSTANTS.BACKGROUND_OPACITY})`,
            "stroke-width": edge_width + CONSTANTS.BACKGROUND_PADDING * 2,
        }).add_to(this.background);

        // The background usually has flat ends, but we want rounded ends. Unfortunately, the
        // `round` endpoint path option in SVG is not suitable, because it takes up too much space,
        // so we have to simulate this ourselves.
        const round_bg_mask_end = (endpoint, is_start) => {
            // We should always have endpoints, but if something's gone wrong, we don't want to
            // trigger another error.
            if (endpoint !== null) {
                // First, we cut off the end of the existing background. We're going to replace
                // this with a semicircle.
                const end_cutoff = {
                    width: Math.hypot(endpoint.x - (is_start ? 0 : length), endpoint.y)
                        + CONSTANTS.MASK_PADDING,
                    height: edge_width + (CONSTANTS.BACKGROUND_PADDING + MASK_PADDING) * 2,
                };
                // This is an overapproximation of the ends, but this is okay, as we're going to
                // draw the semicircle ends over the top of this.
                new DOM.SVGElement("rect", {
                    width: end_cutoff.width,
                    height: end_cutoff.height,
                    x: is_start ? -end_cutoff.width : 0,
                    y: -end_cutoff.height / 2,
                    fill: "black",
                    transform: `translate(${endpoint.x}, ${height / 2 + endpoint.y}) rotate(${endpoint.angle * 180 / Math.PI})`,
                }).add_to(bg_mask);
                // Draw the semicircle (actually a circle, but half of it is idempotent).
                new DOM.SVGElement("circle", {
                    cx: endpoint.x,
                    cy: endpoint.y + height / 2,
                    r: edge_width / 2 + PADDING_S,
                    fill: "white",
                }).add_to(bg_mask);
            }
        }
        round_bg_mask_end(start, true);
        round_bg_mask_end(end, true);

        // Redraw the arrow itself.

        // Hooks are drawn at the end of the line, so we must adjust the length of the line
        // to account for them. All other arrowhead styles are drawn within the bounds of the
        // edge.
        const shorten = {
            start: tails.length > 1 && tails[0].startsWith("hook") ? head_width : 0,
            end: heads.length > 1 && heads[0].startsWith("hook") ? head_width : 0,
        };

        // Size the SVG correctly, and rotate the arrow about the source, in the direction of the
        // target.
        this.svg.set_style({
            width: `${svg_width}px`,
            height: `${svg_height}px`,
            transformOrigin: `0 ${svg_height / 2}px`,
            transform: `
                translate(${this.source.x}px, ${this.source.y - svg_height / 2}px)
                rotate(${angle}rad)
                translate(${-padding_x}px, ${-padding_y}px)
            `
        });
        // We are going to redraw everything from scratch, so clear the current SVG.
        this.svg.clear();
        // Set the view box to match the length and height of the arrow (not taking padding into
        // account).
        this.svg.set_attributes({ viewBox: `0 0 ${length} ${height}` });

        // Create a clipping mask for the edge. We use this to cut out the gaps in an n-cell.
        const defs = new DOM.SVGElement("defs").add_to(this.svg);
        const clipping_mask = new DOM.SVGElement("mask", {
            id: "clipping-mask",
            maskUnits: "userSpaceOnUse",
        }).add_to(defs);
        // By default, we draw everything.
        new DOM.SVGElement("rect", {
            width: svg_width,
            height: svg_height,
            x: -padding_x,
            y: -padding_y,
            fill: "white",
        }).add_to(clipping_mask);

        // Draw the edge itself.
        const edge = new DOM.SVGElement("path", {
            mask: "url(#clipping-mask)",
            fill: "none",
            stroke: "black",
            "stroke-width": edge_width,
            // We'd prefer to use `round`, especially for dashed and dotted lines, but unfortunately
            // this doesn't work well with thicker edges. Ideally, we want a `round-butt` option,
            // specifying edges do not extend farther than the path.
            // We manually draw rounded ends for the overall path, but we avoid doing this for every
            // dash, as this would be very expensive.
            "stroke-linecap": "butt",
        }).add_to(this.svg);

        /// Finds the intersection of the Bézier curve with either the source or target. There
        /// should be a unique intersection point, and this will be true in all but extraordinary
        /// circumstances: namely, when the source and target are overlapping. In this case, we
        /// pick either the earliest (if `prefer_min`) or latest intersection point (otherwise).
        const find_endpoint = (bounding_rect, prefer_min) => {
            const bezier =
                new Bezier(new Point(this.source.x, this.source.y), length, curve, angle);
            const intersections = bezier.intersections_with_rounded_rectangle(new RoundedRectangle(
                bounding_rect.x,
                bounding_rect.y,
                bounding_rect.width,
                bounding_rect.height,
                bounding_rect.radius,
            ));
            if (intersections.length === 0) {
                // We should always have at least one intersection, as the Bézier curve spans the
                // endpoints, so this is an error.
                console.error("No intersection found for Bézier curve with endpoint.");
                // Try to continue drawing *something*.
                return Point.zero();
            }
            return intersections[prefer_min ? 0 : intersections.length - 1];
        }

        // The path of the edge, with a normalised origin and angle.
        const bezier = new Bezier(Point.zero(), length, curve, 0);
        const t_after_length = bezier.t_after_length();

        const start = find_endpoint(source, true);
        const end = find_endpoint(target, false);

        const { path, dash_array } = this.edge_path();
        edge.set_attributes({ d: `${path}` });
        edge.set_attributes({ "stroke-dasharray": dash_array });

        // We now draw the various parts making up the n-cell. The `edge` SVG is drawn as a thick
        // solid line. We are going to apply a clipping mask, cutting out the parts of the line that
        // ought not to be there. This makes it look as if we have multiple parallel lines, when
        // we're really recursively cutting parts out: we first cut out a line that's a little
        // thinner than `edge`, then we cut out a piece of *that* line, that's a little thinner
        // still... all the way until we reach the end.
        // You may wonder why we don't just try to offset n different lines. This would be ideal,
        // and simpler. However, an offset Bézier curve is no longer a Bézier curve, so we would
        // have to draw all these parallel paths manually, using line segments. This recursive
        // cutting approach allows us to make use of SVG's Bézier abilities, which is nicer.
        for (let i = this.style.level - 1, cut = true; i > 0; --i, cut = !cut) {
            new DOM.SVGElement("path", {
                d: `${path}`,
                fill: "none",
                stroke: cut ? "black" : "white",
                "stroke-width": `${
                    (i - (cut ? 1 : 0)) * CONSTANTS.STROKE_WIDTH
                        + (i - (cut ? 0 : 1)) * CONSTANTS.LINE_SPACING
                }`,
            }).add_to(clip);
        }

        // At present, we don't clip the edge using the source and target masks, but this might be
        // something we do in the future.

        const draw_heads = (heads, endpoint, is_start) => {
            const head = redraw_heads(heads, endpoint, is_start, false);
            if (head !== null) {
                this.svg.add(head);
            }
            const mask = redraw_heads(heads, endpoint, is_start, false);
            if (mask !== null) {
                this.svg.add(mask);
            }
        };

        // Draw the tails and heads.
        draw_heads(this.style.tails, start, true);
        draw_heads(this.style.heads, end, false);
    }

    // Computes the SVG path for the edge itself, whether that's a line, adjunction or squiggly
    // line.
    // Returns `{ path, dash_array }`.
    edge_path() {
        // Various arc lengths, which are used for drawing various parts of the Bézier curve
        // manually (e.g. for squiggly lines) or to determine dash distances.
        let arclen_to_start = bezier.arc_length(start.t) + (this.style.shorten + shorten.start);
        let arclen_to_end = bezier.arc_length(end.t) - (this.style.shorten + shorten.end);
        let arclen = bezier.arc_length(1);

        // Each squiggle triangle has a width equal to twice its height.
        const HALF_WAVELENGTH = CONSTANTS.SQUIGGLY_TRIANGLE_HEIGHT * 2;

        const path = new Path();
        switch (this.style.body_shape) {
            // The normal case: a straight or curved line.
            case CONSTANTS.ARROW_BODY_SHAPE.LINE:
                path.move_to(new Point(0, height / 2));
                // A simple quadratic Bézier curve.
                path.curve_by(new Point(length / 2, curve), new Point(length, 0));
                break;
            // A ⊣ shape, for adjunctions.
            case CONSTANTS.ARROW_BODY_SHAPE.ADJUNCTION:
                const centre = bezier.point(0.5);
                const angle = bezier.tangent(0.5);
                const normal = angle + Math.PI / 2;
                const adj_seg = new Point(CONSTANTS.ADJUNCTION_LINE_LENGTH, 0);
                const adj_seg_2 = adj_seg.div(2);

                // Left.
                path.move_to(lcentre.sub(adj_seg_2.rotate(angle)).add(new Point(0, height / 2)));
                // Right.
                path.line_by(adj_seg.rotate(angle));
                // Top.
                path.move_to(centre.add(adj_seg_2.rotate(angle)).sub(adj_seg_2.rotate(normal)));
                // Bottom.
                path.line_by(adj_seg.rotate(normal));
                break;
            // A squiggly line.
            case CONSTANTS.ARROW_BODY_SHAPE.SQUIGGLY:
                // This case is tricky. Because we want to draw curved squiggly lines, which are
                // (shockingly) not supported by default by SVG, we need to draw these manually.
                // This means we need to draw a Bézier curve, but add little triangles along its
                // arc length. These should look good no matter what the width or height of the
                // Bézier curve.
                if (start === null || end === null) {
                    // We need the endpoints to draw the squiggly line. If they don't exist, this
                    // will have been previously reported, so we simply bail out here.
                    return;
                }

                // The arc length after which to start drawing triangles.
                const arclen_to_squiggle_start =
                    arclen_to_start + total_tails_width + CONSTANTS.SQUIGGLY_PADDING;
                const squiggle_start_point = bezier.point(arclen_to_squiggle_start);
                // The arc length after which to stop drawing triangles.
                const arclen_to_squiggle_end =
                    arclen_to_end - (total_heads_width + CONSTANTS.SQUIGGLY_PADDING);
                // The start and end points.
                const start_point = bezier.point(t_after_length(arclen_to_start));
                const end_point = bezier.point(t_after_length(arclen_to_end));

                // Move to the tail.
                path.move_to(start_point);
                // Draw a straight line segment for the first section. This gives some breathing
                // space around the tail and the squiggles.
                const vertical_offset = new Point(0, height / 2);
                path.line_to(squiggle_start_point.add(vertical_offset));

                // We keep track of the total length of the squiggly path. This is used to calculate
                // dash arrays for dashed lines.
                let path_len = squiggle_start_point.sub(start_point).length();
                let prev_point = squiggle_start_point;

                // We now draw the Bézier curve, augmented by triangular squiggles.
                for (
                    // The current arc length along the Bézier curve we are tracing.
                    let l = arclen_to_squiggle_start,
                    // Which direction to draw the triangle: up (`-1`) or down (`1`).
                    sign = -1,
                    // Whether to draw a point offset by the triangle amplitude (`1`) or not (`0`).
                    m = 1;
                    l + m * HALF_WAVELENGTH / 2 < arclen_to_squiggle_end;
                    // Flip the direction of the triangle each time a triangle
                    // is drawn. We alternate between drawing tips and bases of
                    // the triangles.
                    sign = [sign, -sign][m], m = 1 - m
                ) {
                    l += HALF_WAVELENGTH / 2;
                    const t = t_after_length(l);
                    const point = bezier.point(t);
                    const angle = bezier.tangent(t) + Math.PI / 2 * sign;
                    const next_point = point.x.add(Point.lendir(AMPLITUDE * m, angle));
                    path_len += next_point.sub(prev_point).length();
                    prev_point = next_point;
                    path.push(`L ${next_point.x} ${next_point.y + height / 2}`);
                }

                // Draw the padding next to the head of the arrow.
                path.line_to(end_point.add(vertical_offset));
                path_len += end_point.sub(prev_point).length();

                // We draw squiggly lines differently from other lines, in that we start then at
                // the start point, rather than the source. We have to take this into account when
                // calculating the arc length.
                arclen_to_start = 0;
                arclen_to_end = arclen = path_len;

                break;
        }

        // Now we will set the dash style for the edge. It would be nice to just use the SVG
        // `stroke-dasharray` option and be done with it. However, we use `stroke-dasharray` to
        // avoid drawing the entire Bézier curve. That is, the path of the Bézier curve is between
        // the source and target for simplicity in calculation (namely, the Bézier curves are then
        // always symmetric), but we really only want to draw it between the endpoints. The
        // solution we pick is to use `stroke-dasharray` to avoid drawing the stroke except between
        // the endpoints, but this means that when drawing dashes, we need to explicitly calculate
        // how many dashes we're going to draw. This falls into an all-too-common pattern here where
        // we end up doing things manually because we're not given enough flexibility. Drawing
        // modular arrows turns out to be pretty tricky.

        if (start === null || end === null) {
            // We can't effectively draw dashed lines when we don't know where the tail and head
            // are.
            return;
        }

        // When we draw squiggly arrows, we have straight line padding near the tail and head, which
        // we need to account for when drawing dashed lines.
        const adjust_dash_padding = (heads, endpoint, is_start) => {
            if (this.style.tails.length > 0 && this.style.tails[0] === "mono") {
                // The "mono" style is special in that its angle is not based on an endpoint, but is
                // offset from an endpoint. When we draw n-cells, if we simply the dashes to the
                // endpoint offset, these will be too short when the rotation of the head is
                // different to the rotation of the endpoint. We therefore have to add some padding
                // at the endpoint to make sure we always draw enough line.
                const head_angle = bezier.tangent(t_after_length(
                    bezier.arc_length(endpoint.t) + head_width * (is_start ? 1 : -1)
                ));
                const endpoint_angle = bezier.tangent(endpoint.t);
                const diff_angle = endpoint_angle - head_angle;
                return Math.abs(edge_width * Math.sin(diff_angle) / 2);
            }
            return 0;
        }

        const dash_padding = {
            start: adjust_dash_padding(this.style.tails, this.source, true),
            end: adjust_dash_padding(this.style.heads, this.target, false),
        };

        let arclen_line = arclen_to_end - arclen_to_end;
        // By default, we draw a single "dash" between the two endpoints.
        let dashes = [arclen_line];

        if (this.style.dash_style !== CONSTANTS.ARROW_DASH_STYLE.SOLID) {
            switch (this.style.body_shape) {
                // It only really makes sense to dash (curved or squiggly) lines.
                case CONSTANTS.ARROW_BODY_SHAPE.LINE:
                case CONSTANTS.ARROW_BODY_SHAPE.SQUIGGLY:
                    // Reset the dash array, because we're calculating everything manually.
                    dashes = [];

                    if (this.style.body_shape === CONSTANTS.ARROW_BODY_SHAPE.SQUIGGLY) {
                        // The initial padding, free of squiggles.
                        dashes.push(head_width + total_tails_width);
                        dashes.push(0);
                        // We need to adjust the length of the line to restrict it to just the
                        // Bézier approximation.
                        arclen_line -= head_width + total_tails_width + total_heads_width;
                    }

                    // We only try to draw dashes if there's any space for them: otherwise, we can
                    // just draw a solid line. We apply this check here to take the squiggly padding
                    // into account.
                    if (arclen_line > 0) {

                        const TRIANGLE_SIDE = HALF_WAVELENGTH * 2 ** 0.5;
                        // A (dash, gap) pair, which will be repeated along the length of the line.
                        // We could pull the constants below out into `CONSTANTS`, but the special-
                        // casing makes this a bit unpleasant, so we leave them here for now.
                        let dash_pairs;
                        if (this.style.body_shape !== CONSTANTS.ARROW_BODY_SHAPE.SQUIGGLY) {
                            switch (this.style.dash_style) {
                                case CONSTANTS.ARROW_DASH_STYLE.DASHED: dash_pairs = [6, 6]; break;
                                case CONSTANTS.ARROW_DASH_STYLE.DOTTED: dash_pairs = [2, 4]; break;
                            }
                        } else {
                            switch (this.style.dash_style) {
                                case CONSTANTS.ARROW_DASH_STYLE.DASHED:
                                    dash_pairs = [2 * TRIANGLE_SIDE, 1 * TRIANGLE_SIDE]; break;
                                case CONSTANTS.ARROW_DASH_STYLE.DOTTED:
                                    dash_pairs = [0.5 * TRIANGLE_SIDE, 0.25 * TRIANGLE_SIDE]; break;
                            }
                        }
                        // The combined length of the dash and gap.
                        const dash_gap_length = dash_pairs.reduce((a, b) => a + b, 0);
                        // How many dashes-and-gaps are required to cover the length of the curve.
                        let dashes_and_gaps = arclen_line / dash_gap_length;

                        // Fill the curve with as many (integer multiples of) dashes and gaps as we
                        // can.
                        dashes = dashes
                            .concat(new Array(Math.floor(dashes_and_gaps)).fill(dashes).flat());
                        // It the required number of dashes and gaps wasn't exactly an integer,
                        // which is exceedingly likely.
                        if (dashes_and_gaps % 1 !== 0) {
                            let deficit =
                                arclen_line - Math.floor(dashes_and_gaps) * dash_gap_length;
                            // While this algorithm is technically more complicated than we need,
                            // when `dash_pairs` always has a length of 2, doing it this way allows
                            // us to extend to more complex dash patterns in the future.
                            for (const l of dash_pairs) {
                                if (l <= deficit) {
                                    dashes.push(l);
                                    deficit -= l;
                                } else {
                                    break;
                                }
                            }
                            // Fill up the remaining gap.
                            dashes.push(deficit);
                            // We need to always end on an odd length of `dashes`, because the array
                            // indicates an alternating sequence of dashes and gaps.
                            if (actual_line_array.length % 2 !== 1) {
                                actual_line_array.push(0);
                            }
                        }

                    } else {
                        dashes = [arclen_line];
                        break;
                    }

                    if (this.style.body_shape === CONSTANTS.ARROW_BODY_SHAPE.SQUIGGLY) {
                        // The terminal padding, free of squiggles.
                        dashes.push(0);
                        dashes.push(head_width + total_heads_width);
                    }

                    break;
            }
        }

        // We always have at least a single dash (the line itself).
        dashes[0] += dash_padding.start;
        dashes[dashes.length - 1] += dash_padding.end;
        const dash_array =
            `0 ${arclen_to_start - dash_padding.start}
            ${dashes.join(" ")} ${arclen - arclen_to_end + dash_padding.end}`;

        return { path, dash_array };
    }

    /// Redraw the heads or tails attached to an end of the edge.
    /// In general, we can draw arbitrary sequences of different arrowheads and they will compose
    /// nicely. However, we don't account for harpoons or hooks in combination with other arrowheads
    /// (even with others of the same kind), as I cannot see how to make these look good in
    /// combination. Thus, passing a non-singleton array containing "harpoon" or "hook" will likely
    /// have unexpected effects, as it has not been tested (likely defaulting to just drawing a
    /// harpoon or hook).
    /// Returns the head path.
    redraw_heads(heads, endpoint, is_start, is_mask) {
        // Note that, throughout, we use `head` as a contraction of `arrowhead`, which can be drawn
        // either at the tail (i.e. close to the source) or at the head of an arrow (i.e. close to
        // the target). This is confusing. Sorry.

        // Early return if we have no arrowheads.
        if (heads.length === 0) {
            return null;
        }

        // The following two constants are used frequently to draw things at the correct end of the
        // edge, or with the correct orientation.
        const start_sign = is_start ? 1 : -1;
        // `ind`icates whether we are drawing at the end.
        const end_ind = is_start ? 0 : 1;

        // We draw all the arrowheads with a single path.
        const path = new Path();

        let arclen_to_endpoint = bezier.arc_length(endpoint.t)
                + (this.style.shorten + is_start ? shorten.start : shorten.end) * start_sign;

        if (includes_any(heads, "harpoon-top", "harpoon-bottom")) {
            // For 1-cells, it would arguably be more aesthetically-pleasing to centre harpoons on
            // their points (which is lower than their centre). However, unfortunately, we can't do
            // this consistently, because it starts to look odd for higher n-cells, as their centres
            // no longer line up, despite connecting two points in a straight line. Therefore, we
            // make do by keeping the centres aligned with the centre of the edge.
            const h = line_width + SPACING;
            const side_sign
                = heads.find((head) => head.startsWith("harpoon")).endsWith("top") ? -1 : 1;
            // Overwrite `where` to taken `shorten` into account.
            const t = t_after_length(arclen_to_endpoint);
            const angle = bezier.tangent(t);
            const point = bezier.point(t)
                .add(new Point(0, height / 2))
                .add(new Point(0, side_sign * line_width / 2 - side_sign * STROKE_WIDTH / 2)
                    .rotate(angle));
            path.move_to(point);
            path.arc_by(
                new Point(start_sign * head_width, h),
                rad_to_deg(angle * 180 / Math.PI),
                false,
                side_sign === 1 ? end_ind : 1 - end_ind,
                new Point(start_sign * head_width, -h * side_sign).rotate(angle),
            );

            if (mask) {
                path.line_by(Point.lendir(-start_sign * (head_width + MASK_PADDING), angle));
                head_path.line_by(
                    mdx * Math.cos(angle) - mdy * Math.sin(angle),
                    mdx * Math.sin(angle) + mdy * Math.cos(angle),
                );
                path.line_by(new Point(0, h * side_sign).rotate(angle));
            }
        } else if (includes_any(heads, "hook-top", "hook-bottom")) {
            if (is_mask) {
                // We don't need masks for hooks, because they're simply drawn perfectly at the
                // ends.
                return null;
            }

            const t = t_after_length(arclen_to_endpoint);
            const base_point = bezier.point(t);
            const angle = bezier.tangent(t);
            const side_sign
                = heads.find((head) => head.startsWith("hook")).endsWith("top") ? -1 : 1;
            // We draw a hook connecting to the ends of each of the n lines forming the n-cell.
            for (let i = 0; i < level; ++i) {
                const point = base_point
                    .add(new Point(0, height / 2))
                    .add(new Point(
                        0,
                        side_sign * edge_width / 2
                            - side_sign * CONSTANTS.STROKE_WIDTH / 2
                            - side_sign * (CONSTANTS.LINE_SPACING + CONSTANTS.STROKE_WIDTH) * i,
                    ).rotate(angle));
                path.move_to(point);
                path.arc_by(
                    new Point(start_sign * head_width, head_width),
                    // We're drawing a semicircle, so the angle is *actually* unimportant.
                    rad_to_deg(angle),
                    // This argument appears to be unimportant.
                    false,
                    side_sign === 1 ? end_ind : 1 - end_ind,
                    new Point(0, side_sign * head_width * 2).rotate(angle),
                );
            }
        } else {
            // The general case. We're going to space the arrowheads evenly along the curve: this
            // means using arc length rather than Euclidean distance. We're going to work out where
            // exactly to place each head: this means keeping track of the arc lengths for each.
            // The higher the index of an element in `heads`, the farher from the endpoint it will
            // be (both for tails and for heads).
            const arclens_to_head = [];
            let prev_margin = 0;
            for (let i = 0, heads_arclen = 0; i < heads.length; ++i) {
                // Some arrowheads compose better with others. To ensure that any combination looks
                // good/acceptable, we have to keep track of several settings. The "left"/"right"
                // terminology refers to the head of an arrow facing right. `margin_begin` is the
                // margin that is applied for the very first arrowhead. This is only relevant for
                // the "mono" style, which is not centred on an endpoint, but is offset.
                let margin_left, margin_right, margin_begin;
                switch (heads[i]) {
                    case "epi":
                    case "corner":
                        [margin_left, margin_right, margin_begin] = [head_width, 0, 0];
                        break;
                    case "mono":
                        [margin_left, margin_right, margin_begin] = [0, head_width, head_width];
                        break;
                    case "maps to":
                        [margin_left, margin_right, margin_begin]
                            = [head_width / 2, head_width / 2, 0];
                        break;
                }

                if (i === 0) {
                    heads_arclen += margin_begin;
                } else {
                    // When we have multiple heads of the same type in a row, we can collapse them
                    // together, because each will fill the whitespace of the previous.
                    const collapse = heads[i] === heads[i - 1] ? 2 : 1;
                    heads_arclen +=
                        ((prev_margin + margin_right) / collapse + CONSTANTS.HEAD_SPACING);
                }

                prev_margin = margin_left;
                arclens_to_head.push(heads_arclen);
            }

            // Now we draw each head. We could combine this with the previous loop, but separate
            // out the two cases for readability.
            for (let i = heads.length - 1; i >= 0; --i) {
                // We only draw a mask for the arrowhead closest to the endpoint.
                if (is_mask && i !== 0) continue;

                const head_style = heads[i];
                const arclen_to_head = arclen_to_endpoint + arclens_to_head[i];
                const t = t_after_length(arclen_to_head);
                const point = bezier.point(t);
                let angle = bezier.tangent(t);
                let angle_deg = rad_to_deg(angle);

                switch (head_style) {
                    case "mono":
                        angle += Math.PI;
                        angle_deg += 180;
                        // We intend to fall down into the "epi" branch: this is not an accidental
                        // mistake.
                    case "epi":
                        // angle add (type === "mono" ? Math.PI : 0)
                        path.move_to(point.add(new Point(0, height / 2)));
                        // Draw the two halves of the head.
                        for (const [side_sign, side_ind] of [[-1, end_ind], [1, 1 - end_ind]]) {
                            path.arc_by(
                                new Point(start_sign * head_width, head_height / 2),
                                angle_deg,
                                false,
                                side_ind,
                                new Point(start_sign * head_width, side_sign * head_height / 2)
                                    .rotate(angle),
                            );
                            if (is_mask) {
                                let distance;
                                switch (type) {
                                    case "epi":
                                        distance
                                            = -start_sign * (head_width + CONSTANTS.MASK_PADDING);
                                        break;
                                    case "mono":
                                        // We have to pad the mask for "mono" for the same reason we
                                        // add `dash_padding`. In this case, we have to add twice as
                                        // much, because the padding is added everywhere, even where
                                        // it is not needed, so we need to make sure we cover it with
                                        // the mask.
                                        const padding
                                            = (is_start ? dash_padding.start : dash_padding.end)
                                                * 2;
                                        distance = start_sign * (MASK_PADDING + padding);
                                        break;
                                }
                                path.line_by(Point.lendir(dis, angle));
                                path.line_by(
                                    new Point(0, -side_sign * head_height / 2).rotate(angle)
                                );
                            }
                        }
                        break;

                    // The corner symbol used for pullbacks and pushouts.
                    case "corner":
                        const LENGTH = 12;
                        const base_2 = LENGTH / (2 ** 0.5);
                        const point = bezier.point(t_after_length(arclen + base_2 * start_sign));

                        // Draw the two halves of the head.
                        for (const side_sign of [-1, 1]) {
                            head_path.move_to(point.add(new Point(0, height / 2)));

                            // Round the angle to the nearest 45º and adjust with respect to the
                            // current direction.
                            const PI_4 = Math.PI / 4;
                            const direction = this.target.sub(this.source).angle();
                            const corner_angle
                                = Math.PI + PI_4 * Math.round(4 * direction / Math.PI) - direction;

                            head_path.line_by(Point.lendir(
                                LENGTH,
                                corner_angle + Math.PI * (1 - end_ind) + side_sign * Math.PI / 4,
                            ));
                        }
                        break;

                    case "maps to":
                        head_path.move_to(point.add(
                            new Point(0, height / 2)
                                .add(Point.lendir(head_height / 2, angle + Math.PI / 2))
                        ));
                        head_path.line_by(Point.lendir(head_height, angle - Math.PI / 2));
                        break;
                }


            }
        }

        return new DOM.SVGElement("path", {
            d: `${path}`,
            fill: is_mask ? "black" : "none",
            stroke: !is_mask ? "black" : "none",
            "stroke-width": CONSTANTS.STROKE_WIDTH,
            "stroke-linecap": "round",
        });
    }

    /// Redraw the label attached to the edge. Returns the mask associated to the label.
    redraw_label(label) {
        const length = Math.hypot(this.target.y - this.source.y, this.target.x - this.source.x);
        const angle = Math.atan2(this.target.y - this.source.y, this.target.x - this.source.x);

        const centre = this.determine_label_position(label).add(new Point(
            -label.width / 2,
            (height - label.height) / 2,
        ));

        // Draw the mask.
        const mask = new DOM.SVGElement("rect", {
            width: label.width,
            height: label.height,
            x: centre.x,
            y : centre.y,
            fill: "black",
            transform:
                `rotate(${-rad_to_deg(angle)} ${length / 2} ${(height + this.style.curve) / 2})`,
        });

        return mask;
    }

    /// Find the correct position of the label. If the label is centred, this is easy. However, if
    /// it is offset to either side, we want to find the minimum offset from the centre of the edge
    /// such that the label no longer overlaps the edge.
    determine_label_position(label) {
        const edge_width = this.edge_width();
        const length = Math.hypot(this.target.y - this.source.y, this.target.x - this.source.x);
        const angle = Math.atan2(this.target.y - this.source.y, this.target.x - this.source.x);

        // To offset the label bounding rectangle properly, we're going to iterately approximate its
        // location. We first normalise the Bézier curve (flat Bézier curves must be special-cased).
        // We then find all the intersections of the bounding rectangle with the curve: we want the
        // number of intersections to be zero. To find this distance, we do a binary search (between
        // 0 and the height of the curve). We also add padding to the bounding rectangle to simulate
        // the thickness of the curve.
        let offset_min = 0;
        let offset_max = Math.abs(this.style.curve) / 2
            + Math.hypot((label.width + edge_width) / 2, (label.height + edge_width) / 2);
        // The following variable will be initialised by the following loop, which runs at least
        // once.
        let offset;

        const BAIL_OUT = 1024;
        let i = 0;
        while (true) {
            // We will try offseting at distance `offset` pixels next.
            offset = (offset_min + offset_max) / 2;
            const rect_centre =
                new Point(length / 2, this.style.curve / 2)
                    .rotate(angle)
                    .add(new Point(offset).rotate(angle + Math.PI / 2));
            // Compute the intersections between the offset bounding rectangle and the edge.
            const intersections = new Bezier(Point.zero(), length, this.style.curve, angle)
                .intersections_with_rounded_rectangle(new RoundedRectangle(
                    rect_centre.x,
                    rect_centre.y,
                    label.width + edge_width,
                    label.height + edge_width,
                    edge_width / 2,
                ));
            if (intersections.length === 0) {
                // If we've determined the offset to a sufficiently-high precision, we can stop
                // here, as this offset is sufficient.
                if (offset_max - offset_min < 1) {
                    break;
                }
                // Otherwise, we update the bounds to narrow down on the right offset.
                [offset_min, offset_max] = [offset_min, offset];
            } else {
                [offset_min, offset_max] = [offset, offset_max];
            }

            if (i >= BAIL_OUT) {
                // Reaching this case is an error: we should always be able to find an offset that
                // has no intersection. However, it's better to bail out if there's a mistake, than
                // to cause an infinite loop.
                console.error("Had to bail out from determining label offset.");
                break;
            }
        }

        return new Point(length / 2, this.style.curve / 2)
            .add(new Point(offset).rotate(angle + Math.PI / 2));
    }
}
