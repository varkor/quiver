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
        this.element = new DOM.SVGElement("svg", { xmlns: DOM.SVGElement.NAMESPACE });
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
    SQUIGGLY_PADDING: 4,
    /// The height (in pixels) of a single triangle of the squiggly arrow body style.
    SQUIGGLY_TRIANGLE_HEIGHT: 2,
    /// The length of the line segments in an adjunction symbol (⊣).
    ADJUNCTION_LINE_LENGTH: 16,
    /// The length of the line segments in a corner (i.e. a pullback or pushout).
    CORNER_LINE_LENGTH: 12,
    /// The radius of the handle for dragging an edge.
    HANDLE_RADIUS: 14,
    /// The possible styles for an edge.
    ARROW_BODY_STYLE: new Enum(
        "ARROW_BODY_STYLE",
        // No edge ( ).
        "NONE",
        // A line (—). This is the default.
        "LINE",
        // A squiggly line, made up of alternating triangles (⟿).
        "SQUIGGLY",
        // The adjunction symbol: ⊣.
        "ADJUNCTION",
        // A line with a bar through it (-+-).
        "PROARROW",
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
        /// The corner of a square, used for an alternate style for pullbacks and pushouts.
        CORNER_INVERSE: ["corner-inverse"],
    },
    /// The various label alignment options.
    LABEL_ALIGNMENT: new Enum(
        "LABEL_ALIGNMENT",
        // In the centre of an edge, cutting out the edge underneath it.
        "CENTRE",
        // In the centre of an edge, overlapping the edge underneath it.
        "OVER",
        // To the left of the edge, viewed as if the arrow is facing up.
        "LEFT",
        // To the right of the edge, viewed as if the arrow is facing up.
        "RIGHT",
    ),
};


class ArrowStyle {
    constructor() {
        // The "n" in "n-cell". Must be a positive integer.
        this.level = 1;
        // The position of the label (from 0 to 1) along the arrow.
        this.label_position = 0.5;
        // The height of the curve (in pixels). May be positive or negative.
        this.curve = 0;
        // The offset of the curve (in pixels). May be positive or negative.
        this.shift = 0;
        // How much to offset the head and tail of the edge from their endpoints.
        this.shorten = { tail: 0, head: 0 };
        // The various styles for the head, body, and tail.
        this.body_style = CONSTANTS.ARROW_BODY_STYLE.LINE;
        this.dash_style = CONSTANTS.ARROW_DASH_STYLE.SOLID;
        this.heads = CONSTANTS.ARROW_HEAD_STYLE.NORMAL;
        this.tails = CONSTANTS.ARROW_HEAD_STYLE.NONE;
        // The colour of the arrow.
        this.colour = "black";
    }
}

class Label {
    constructor() {
        this.size = Dimensions.zero();
        this.alignment = CONSTANTS.LABEL_ALIGNMENT.CENTRE;
        this.element = null;
    }
}

class Shape {}

Shape.RoundedRect = class extends Shape {
    constructor(origin, size, radius) {
        super();
        this.origin = origin;
        this.size = size;
        this.radius = radius;
    }
}

// The endpoint of a Bézier curve. This is used when we want to draw a Bézier curve in
// its entirety.
Shape.Endpoint = class extends Shape {
    constructor(origin) {
        super();
        this.origin = origin;
    }
}

class Arrow {
    constructor(source, target, style = new ArrowStyle(), label = null) {
        this.source = source;
        this.target = target;
        this.style = style;
        this.label = label;

        // We need to have unique `id`s for each arrow, to assign masks and clipping paths.
        this.id = Arrow.NEXT_ID++;
        this.element = new DOM.Div({ class: "arrow" });
        // The background to the edge, with which the user may interact.
        this.background = new DOM.SVGElement("svg").add_to(this.element);
        // The SVG containing the edge itself, including the arrow head and tail.
        this.svg = new DOM.SVGElement("svg").add_to(this.element);
        // The mask to be used for any edges having this edge as a source or target.
        this.mask = new DOM.SVGElement("svg");
    }

    /// Returns the vector from source to target.
    vector() {
        return this.target.origin.sub(this.source.origin);
    }

    /// Returns the angle of the vector from source to target.
    angle() {
        return this.vector().angle();
    }

    /// Returns the underlying Bézier curve associated to the arrow.
    bezier() {
        return new Bezier(
            Point.zero(),
            this.vector().length(),
            this.style.curve,
            0,
        );
    }

    /// Returns the points along the Bézier curve associated to the arrow that intersect with the
    /// source and target.
    /// Returns either an array `[start, end]` or throws an error if the curve is invalid and has no
    /// nontrivial endpoints.
    find_endpoints() {
        const diff = this.vector();
        const [length, angle] = [diff.length(), diff.angle()];

        /// Finds the intersection of the Bézier curve with either the source or target. There
        /// should be a unique intersection point, and this will be true in all but extraordinary
        /// circumstances: namely, when the source and target are overlapping. In this case, we
        /// pick either the earliest (if `prefer_min`) or latest intersection point (otherwise).
        const find_endpoint = (endpoint_shape, prefer_min) => {
            const bezier = new Bezier(this.source.origin, length, this.style.curve, angle);

            // The case when the endpoint is simply a point.
            if (endpoint_shape instanceof Shape.Endpoint || endpoint_shape.size.is_zero()) {
                // In this case, there is a trivial intersection with either the source or target.
                const t = prefer_min ? 0 : 1;
                return new BezierPoint(
                    endpoint_shape.origin.sub(this.source.origin).rotate(-angle),
                    t,
                    bezier.tangent(t),
                );
            }

            // The case when the endpoint is a rounded rectangle.
            // The following function call may throw an error, which should be caught by the caller.
            const intersections = bezier.intersections_with_rounded_rectangle(
                new RoundedRectangle(
                    endpoint_shape.origin,
                    endpoint_shape.size,
                    endpoint_shape.radius,
                ),
                false,
            );
            if (intersections.length === 0) {
                // We should always have at least one intersection, as the Bézier curve spans
                // the endpoints, so this is an error.
                console.error(
                    "No intersection found for Bézier curve with endpoint.",
                    endpoint_shape,
                    bezier,
                );
                // Bail out.
                throw new Error("No intersections found.");
            }
            if (intersections.length > 1 && Bezier.point_inside_polygon(
                    (prefer_min ? this.target : this.source).origin,
                    new RoundedRectangle(endpoint_shape.origin, endpoint_shape.size, 0).points(),
            )) {
                // It's difficult to draw this case gracefully, so we bail out here too.
                throw new Error("The Bézier re-enters an endpoint rectangle.");
            }
            return intersections[prefer_min ? 0 : intersections.length - 1];
        }

        const start = find_endpoint(this.source, true);
        const end = find_endpoint(this.target, false);
        return [start, end];
    }

    /// Return an existing element, or create a new one if it does not exist.
    /// This is more efficient, and also preserves event listeners on the existing elements.
    /// The `selector` may be of the form `element#optional-id.class1.class2...`.
    requisition_element(
        parent,
        selector,
        attributes = {},
        style = {},
        namespace = DOM.SVGElement.NAMESPACE,
    ) {
        const elements = parent.query_selector_all(selector);
        switch (elements.length) {
            case 0:
                const [prefix, ...classes] = selector.split(".");
                const [name, id = null] = prefix.split("#");
                const extra_attrs = {};
                if (id !== null) {
                    extra_attrs.id = id;
                }
                if (classes.length > 0) {
                    extra_attrs.class = classes.join(" ");
                }
                return new DOM.Element(
                    name,
                    Object.assign(extra_attrs, attributes),
                    style,
                    namespace,
                ).add_to(parent);
            case 1:
                // Overwrite existing attributes and styling.
                elements[0].set_attributes(attributes);
                elements[0].set_style(style);
                return elements[0];
            default:
                console.error("Found multiple candidates for requisitioning.");
                break;
        }
    }

    /// Remove an existing element, or do nothing if it does not exist.
    release_element(parent, selector) {
        const elements = parent.query_selector_all(selector);
        switch (elements.length) {
            case 0:
                // It's already released, so we can ignore.
                break;
            case 1:
                elements[0].remove();
                break;
            default:
                console.error("Found multiple candidates for releasing.");
                break;
        }
    }

    /// Redraw the arrow, its mask, and its background. We should minimise calls to `redraw`: it
    /// should only be called if something has actually changed: for instance, its position or
    /// properties.
    redraw() {
        // Calculate some constants that are relevant for all three components of the arrow: the
        // mask, background and the arrow itself.

        // The width of the stroke used for the edge.
        const stroke_width = this.style.level * CONSTANTS.STROKE_WIDTH
            + (this.style.level - 1) * CONSTANTS.LINE_SPACING;
        // The total width of the edge line itself, not including the arrowhead, tail, label or /
        // background. This is usually just the `stroke_width`, but when the edge is squiggly, the
        // lines must be spaced out more to leave enough room between the triangles, and so the
        // total width will be greater.
        const edge_width = this.style.body_style === CONSTANTS.ARROW_BODY_STYLE.SQUIGGLY ?
            this.style.level * CONSTANTS.SQUIGGLY_TRIANGLE_HEIGHT * 2
                + CONSTANTS.STROKE_WIDTH
                + (this.style.level - 1) * CONSTANTS.LINE_SPACING
            : stroke_width;

        // The width of an arrowhead, considered pointing left-to-right.
        // This was determined by experimenting with what looked nice.
        const head_width =
            (CONSTANTS.LINE_SPACING + CONSTANTS.STROKE_WIDTH) + (this.style.level - 1) * 2;

        // The height of an arrowhead, considered pointing left-to-right.
        // This was determined by experimenting with what looked nice.
        const head_height = edge_width + (CONSTANTS.LINE_SPACING + CONSTANTS.STROKE_WIDTH) * 2;

        // The horizontal and vertical padding. We have the same padding for both axes, because when
        // the curve is very high, the tangent near the source/target can become essentially
        // vertical. We always pad enough for the arrowhead (plus its stroke width).
        const padding = CONSTANTS.BACKGROUND_PADDING +
            + Math.max(head_height, CONSTANTS.STROKE_WIDTH) / 2;

        // The distance from the source to the target.
        const length = this.target.origin.sub(this.source.origin).length();

        // The vertical distance from the straight line connecting the source to the target, and the
        // peak of the curve.
        const height = Math.abs(this.style.curve);

        // The angle of the straight line connecting the source to the target.
        const angle = this.target.origin.sub(this.source.origin).angle();

        // The width and height of the SVG for the arrow.
        const [svg_width, svg_height] = [length + padding * 2, height + padding * 2];

        // The path of the edge, with a normalised origin and angle.
        const bezier = new Bezier(Point.zero(), length, this.style.curve, 0);
        // We clamp `t` to be at most 1, which handles edge cases more conveniently.
        const t_after_length = bezier.t_after_length(true);

        // We centre vertically, so we usually have to offset things by half the height.
        const offset = new Point(padding, padding + height / 2);

        // The offset of the arrow. We don't apply this to `this.element`, because that causes
        // issues with the z-indexes of the handles.
        const shift = new Point(0, this.style.shift).rotate(angle);

        // Reset the validity of the arrow. This will be set in edge cases, e.g. the arrow has
        // negative length, or is completely cropped. Invalid arrows will not be drawn.
        this.element.class_list.remove("invalid");
        this.svg.class_list.remove("invalid");


        let start, end;
        try {
            [start, end] = this.find_endpoints();
        } catch (_) {
            // If we hit this block, the arrow as specified is invalid, because it would be entirely
            // cropped by the source or target. In this case, we do not draw the arrow.
            this.element.class_list.add("invalid");
            return;
        }

        // Clear the SVGs, resize them, and rotate them about the source, in the direction of the
        // target.
        for (const svg of [this.background, this.svg]) {
            // We need to set `width` and `height` explicitly so we can embed the SVGs properly
            // in CSS backgrounds.
            svg.set_attributes({
                width: svg_width,
                height: svg_height,
            });
            svg.set_style({
                width: `${svg_width}px`,
                height: `${svg_height}px`,
                "transform-origin": offset.px(false),
                transform: `
                    translate(${shift.px()})
                    translate(${this.source.origin.sub(offset).px()})
                    rotate(${angle}rad)
                `,
            });
        }

        // Redraw the background.
        // First, set the opacity.
        this.background.set_style({
            opacity: CONSTANTS.BACKGROUND_OPACITY,
        });

        // Draw the actual background. We only want to draw the background from endpoint to
        // endpoint, so we use `stroke-dasharray` to control where the background starts and ends.
        const arclen_to_start = bezier.arc_length(start.t);
        const arclen_to_end = bezier.arc_length(end.t);
        const arclen = bezier.arc_length(1);
        this.requisition_element(this.background, "path.arrow-background", {
            d: `${
                new Path()
                    .move_to(offset)
                    .curve_by(new Point(length / 2, this.style.curve), new Point(length, 0))
            }`,
            fill: "none",
            stroke: "black",
            "stroke-width": edge_width + CONSTANTS.BACKGROUND_PADDING * 2,
            "stroke-dasharray": `0 ${arclen_to_start} ${arclen_to_end - arclen_to_start} ${Math.ceil(arclen - arclen_to_end)}`,
        });

        // The background usually has flat ends, but we want rounded ends. Unfortunately, the
        // `round` endpoint path option in SVG is not suitable, because it takes up too much space,
        // so we have to simulate this ourselves.
        const round_bg_end = (endpoint, is_start) => {
            // We should always have endpoints, but if something's gone wrong, we don't want to
            // trigger another error.
            if (endpoint !== null) {
                const point = offset.add(endpoint);
                const name = is_start ? "source" : "target";
                // Draw the semicircle (actually a circle, but half of it is idempotent).
                this.requisition_element(this.background, `circle.${name}.arrow-background`, {
                    cx: point.x,
                    cy: point.y,
                    r: edge_width / 2 + CONSTANTS.BACKGROUND_PADDING,
                    fill: "black",
                });
                // Add a handle to the endpoint.
                const origin = Point.diag(CONSTANTS.HANDLE_RADIUS).sub(endpoint);
                this.requisition_element(this.element, `div.arrow-endpoint.${name}`, {}, {
                    width: `${CONSTANTS.HANDLE_RADIUS * 2}px`,
                    height: `${CONSTANTS.HANDLE_RADIUS * 2}px`,
                    left: `${endpoint.x}px`,
                    top: `${endpoint.y}px`,
                    "border-radius": `${CONSTANTS.HANDLE_RADIUS}px`,
                    "transform-origin": `${origin.x}px ${origin.y}px`,
                    transform: `
                        translate(${shift.x}px, ${shift.y}px)
                        translate(calc(${this.source.origin.x}px - 50%),
                            calc(${this.source.origin.y}px - 50%))
                        rotate(${angle}rad)
                    `,
                }, null);
            }
        }
        round_bg_end(start, true);
        round_bg_end(end, false);

        // Redraw the arrow itself.

        // Hooks are drawn at the end of the line, so we must adjust the length of the line
        // to account for them. All other arrowhead styles are drawn within the bounds of the
        // edge.
        const shorten = {
            start: this.style.tails.length > 0 && this.style.tails[0].startsWith("hook")
                ? head_width : 0,
            end: this.style.heads.length > 0 && this.style.heads[0].startsWith("hook")
                ? head_width : 0,
        };

        // Create a clipping mask for the edge. We use this to cut out the gaps in an n-cell,
        // and also to cut out space for the label when the alignment is `CENTRE`.
        const defs = this.requisition_element(this.svg, "defs");
        const clipping_mask = this.requisition_element(
            defs,
            `mask#arrow${this.id}-clipping-mask`,
            { maskUnits: "userSpaceOnUse" },
        );
        // We use a separate clipping mask for the label. This is because we want
        // to clip the head, tail and proarrow bar by the label mask, but *not* by
        // the endpoint masks, which otherwise cut into the head and tail. Thus, the
        // mask for the label is duplicated: once in `clipping_mask` and once in
        // `label_clipping_mask`.
        const label_clipping_mask = this.requisition_element(
            defs,
            `mask#arrow${this.id}-label-clipping-mask`,
            { maskUnits: "userSpaceOnUse" },
        );
        for (const mask of [clipping_mask, label_clipping_mask]) {
            // For simplicity, we clear the clipping masks and recreate everything.
            mask.clear();
            // By default, we draw everything.
            this.requisition_element(mask, "rect.base", {
                width: svg_width,
                height: svg_height,
                fill: "white",
            });
        }

        // Draw the edge itself.
        const edge = this.requisition_element(this.svg, "path.arrow-edge", {
            mask: `url(#arrow${this.id}-clipping-mask)`,
            fill: "none",
            stroke: this.style.colour,
            "stroke-width": stroke_width,
            // We use the default `stroke-linecap` option of `butt`. We'd prefer to use `round`,
            // especially for dashed and dotted lines, but unfortunately this doesn't work well with
            // thicker edges. Ideally, we want a `round-butt` option, specifying edges do not extend
            // farther than the path. We manually draw rounded ends for the overall path, but we
            // avoid doing this for every dash, as this would be very expensive.
        });

        // When we draw squiggly arrows, we have straight line padding near the tail and head, which
        // we need to account for when drawing dashed lines.
        const adjust_dash_padding = (heads, endpoint, is_start) => {
            if (heads.length > 0 && heads[0] === "mono") {
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
            start: adjust_dash_padding(this.style.tails, start, true),
            end: adjust_dash_padding(this.style.heads, end, false),
        };

        // We use some of these variables frequently in other methods, so we package them up for
        // convenience in passing them around.
        const constants = {
            bezier, start, end, length, height, angle, stroke_width, edge_width, head_width,
            head_height, shorten, t_after_length, dash_padding, offset,
        };

        // Draw the the proarrow bar.
        if (this.style.body_style === CONSTANTS.ARROW_BODY_STYLE.PROARROW) {
            const centre = bezier.point(0.5).add(offset);
            const angle = bezier.tangent(0.5);
            const normal = angle + Math.PI / 2;
            const adj_seg = new Point(head_height, 0);
            const adj_seg_2 = adj_seg.div(2);

            const path = new Path();
            // Top.
            path.move_to(centre.sub(adj_seg_2.rotate(normal)));
            // Bottom.
            path.line_by(adj_seg.rotate(normal));

            this.requisition_element(this.svg, "path.arrow-bar", {
                d: `${path}`,
                mask: `url(#arrow${this.id}-label-clipping-mask)`,
                fill: "none",
                stroke: this.style.colour,
                "stroke-width": CONSTANTS.STROKE_WIDTH,
                "stroke-linecap": "round",
            });
        } else {
            this.release_element(this.svg, "path.arrow-bar");
        }

        // We calculate the widths of the tails and heads whilst drawing them, so we have to
        // sandwich the code to draw heads and tails in between the code to draw the path.
        const draw_heads = (heads, endpoint, is_start, is_mask) => {
            const { path: head, total_width }
                = this.redraw_heads(constants, heads, endpoint, is_start, is_mask);
            if (head !== null) {
                const element = !is_mask ? this.svg : clipping_mask;
                element.add(head);
            }
            return total_width;
        };

        // Clear any existing tails and heads: we're going to recreate them.
        this.svg.query_selector_all(".arrow-head").forEach((element) => element.remove());
        // Draw the tails and heads.
        constants.total_width_of_tails = draw_heads(this.style.tails, start, true, false);
        constants.total_width_of_heads = draw_heads(this.style.heads, end, false, false);

        // Check that the arrow length is actually nonnegative.
        if (arclen_to_end - arclen_to_start
            - this.style.shorten.tail - this.style.shorten.head
            - shorten.start - shorten.end
            - dash_padding.start - dash_padding.end
            - constants.total_width_of_tails - constants.total_width_of_heads
            < 0
        ) {
            // The arrow length is negative. Only the arrow edge is marked as invalid, rather than
            // the entire element, because the background may still sensibly be drawn.
            this.svg.class_list.add("invalid");
            return;
        }

        // Draw the edge shape and compute the dash array.
        const { path, dash_array } = this.edge_path(constants);
        edge.set_attributes({ d: `${path}` });
        if (dash_array !== null) {
            edge.set_attributes({ "stroke-dasharray": dash_array });
        } else {
            edge.remove_attributes("stroke-dasharray");
        }

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
            }).add_to(clipping_mask);
        }

        // Draw the tail and head masks. There are two components: a mask up until the
        // endpoints, which deals with general overflow (especially egregious for squiggly arrows);
        // and specific masks for each of the head styles.
        // We need some padding to avoid aliasing issues.
        const ENDPOINT_PADDING = 1;
        new DOM.SVGElement("path", {
            d: `${
                new Path()
                    .move_to(offset)
                    .curve_by(new Point(length / 2, this.style.curve), new Point(length, 0))
            }`,
            fill: "none",
            stroke: "black",
            "stroke-width": edge_width + CONSTANTS.BACKGROUND_PADDING * 2,
            "stroke-dasharray": `${
                arclen_to_start + this.style.shorten.tail + shorten.start + ENDPOINT_PADDING} ${
                arclen_to_end - (arclen_to_start + shorten.start + this.style.shorten.tail
                    + ENDPOINT_PADDING * 2 + this.style.shorten.head + shorten.end)
            } ${arclen - arclen_to_end + this.style.shorten.head + shorten.end + ENDPOINT_PADDING}`,
        }).add_to(clipping_mask);
        draw_heads(this.style.tails, start, true, true);
        draw_heads(this.style.heads, end, false, true);

        // At present, we don't clip the edge using the source and target masks, but this might be
        // something we do in the future.

        // Draw the label.
        if (this.label !== null) {
            // Clip the edge by the label mask.
            if (this.label.alignment === CONSTANTS.LABEL_ALIGNMENT.CENTRE) {
                // We add the label mask to both the `clipping_mask` (for the arrow edge)
                // and `label_clipping_mask` (for heads, tails and the proarrow bar).
                this.redraw_label(constants, "rect").add_to(clipping_mask);
                this.redraw_label(constants, "rect").add_to(label_clipping_mask);
            }
            // Release the existing label.
            const label_content = this.svg.query_selector(".arrow-label div");
            this.release_element(this.svg, "foreignObject.arrow-label");
            // Create a new label.
            const label = this.redraw_label(constants, "foreignObject");
            label.set_attributes({ class: "arrow-label" });
            // Add a generic content container, which makes it more convenient to manipulate.
            // If we previously had content, we reuse that.
            this.label.element = (label_content || new DOM.Div({
                xmlns: "http://www.w3.org/1999/xhtml",
                class: "label",
            })).add_to(label);
            this.svg.add(label);
        }
    }

    // Computes the SVG path for the edge itself, whether that's a line, adjunction or squiggly
    // line.
    // Returns `{ path, dash_array }`.
    edge_path(constants) {
        // Various arc lengths, which are used for drawing various parts of the Bézier curve
        // manually (e.g. for squiggly lines) or to determine dash distances.
        const {
            bezier, start, end, length, shorten, t_after_length, dash_padding, total_width_of_tails,
            total_width_of_heads, offset,
        } = constants;
        let arclen_to_start = bezier.arc_length(start.t) + (this.style.shorten.tail + shorten.start)
            - dash_padding.start;
        let arclen_to_end = bezier.arc_length(end.t) - (this.style.shorten.head + shorten.end)
            + dash_padding.end;
        let arclen = bezier.arc_length(1);

        // Each squiggle triangle has a width equal to twice its height.
        const HALF_WAVELENGTH = CONSTANTS.SQUIGGLY_TRIANGLE_HEIGHT * 2;

        const path = new Path();
        switch (this.style.body_style) {
            // The normal case: a straight or curved line.
            case CONSTANTS.ARROW_BODY_STYLE.LINE:
            case CONSTANTS.ARROW_BODY_STYLE.PROARROW:
                path.move_to(offset);
                // A simple quadratic Bézier curve.
                path.curve_by(new Point(length / 2, this.style.curve), new Point(length, 0));
                break;

            // A ⊣ shape, for adjunctions.
            case CONSTANTS.ARROW_BODY_STYLE.ADJUNCTION:
                const centre = bezier.point(0.5).add(offset);
                const angle = bezier.tangent(0.5);
                const normal = angle + Math.PI / 2;
                const adj_seg = new Point(CONSTANTS.ADJUNCTION_LINE_LENGTH, 0);
                const adj_seg_2 = adj_seg.div(2);

                // Left.
                path.move_to(centre.sub(adj_seg_2.rotate(angle)));
                // Right.
                path.line_by(adj_seg.rotate(angle));
                // Top.
                path.move_to(centre.add(adj_seg_2.rotate(angle)).sub(adj_seg_2.rotate(normal)));
                // Bottom.
                path.line_by(adj_seg.rotate(normal));
                break;

            // A squiggly line.
            case CONSTANTS.ARROW_BODY_STYLE.SQUIGGLY:
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
                    arclen_to_start + total_width_of_tails + CONSTANTS.SQUIGGLY_PADDING;
                const squiggle_start_point = bezier.point(t_after_length(arclen_to_squiggle_start));
                // The arc length after which to stop drawing triangles.
                const arclen_to_squiggle_end =
                    arclen_to_end - (total_width_of_heads + CONSTANTS.SQUIGGLY_PADDING);
                // The start and end points.
                const start_point = bezier.point(t_after_length(arclen_to_start));
                const end_point = bezier.point(t_after_length(arclen_to_end));

                // Move to the tail.
                path.move_to(start_point.add(offset));
                // Draw a straight line segment for the first section. This gives some breathing
                // space around the tail and the squiggles.
                path.line_to(squiggle_start_point.add(offset));

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
                    const angle = bezier.tangent(t) + Math.PI / 2 * sign;
                    const next_point = bezier.point(t).add(
                        Point.lendir(CONSTANTS.SQUIGGLY_TRIANGLE_HEIGHT * m, angle)
                    );
                    path_len += next_point.sub(prev_point).length();
                    prev_point = next_point;
                    path.line_to(next_point.add(offset));
                }

                // Draw the padding next to the head of the arrow.
                path.line_to(end_point.add(offset));
                path_len += end_point.sub(prev_point).length();

                // We draw squiggly lines differently from other lines, in that we start then at
                // the start point, rather than the source. We have to take this into account when
                // calculating the arc length.
                arclen_to_start = 0;
                arclen_to_end = arclen = path_len + dash_padding.start + dash_padding.end;

                break;
        }

        // Now we will set the dash style for the edge. It would be nice to just use the SVG
        // `stroke-dasharray` option and be done with it. However, we already use `stroke-dasharray`
        // to avoid drawing the entire Bézier curve. That is, the path of the Bézier curve is
        // between the source and target for simplicity in calculation (namely, the Bézier curves
        // are then always symmetric), but we really only want to draw it between the endpoints. The
        // solution we pick is to use `stroke-dasharray` to avoid drawing the stroke except between
        // the endpoints, but this means that when drawing dashes, we need to explicitly calculate
        // how many dashes we're going to draw. This falls into an all-too-common pattern here where
        // we end up doing things manually because we're not given enough flexibility. Drawing
        // modular arrows turns out to be pretty tricky.

        if (start === null || end === null
            || this.style.body_style === CONSTANTS.ARROW_BODY_STYLE.ADJUNCTION
        ) {
            // We can't effectively draw dashed lines when we don't know where the tail and head
            // are. Additionally, drawing dashes doesn't make sense for the adjunction symbol.
            return { path, dash_array: null };
        }

        let arclen_line = arclen_to_end - arclen_to_start;
        // By default, we draw a single "dash" between the two endpoints.
        let dashes = [arclen_line];

        if (this.style.dash_style !== CONSTANTS.ARROW_DASH_STYLE.SOLID) {
            switch (this.style.body_style) {
                // It only really makes sense to dash (curved or squiggly) lines.
                case CONSTANTS.ARROW_BODY_STYLE.SQUIGGLY:
                    if (this.style.level > 1) {
                        // We can't draw dashed or dotted n-cells nicely, at least for n > 1, so we
                        // report this as an error.
                        console.error(
                            "Dashed and dotted lines are only supported for squiggly n-cells where "
                            + "n = 1."
                        );
                        break;
                    }

                // We are deliberately falling through here.
                case CONSTANTS.ARROW_BODY_STYLE.LINE:
                case CONSTANTS.ARROW_BODY_STYLE.PROARROW:
                    // Reset the dash array, because we're calculating everything manually.
                    dashes = [];

                    if (this.style.body_style === CONSTANTS.ARROW_BODY_STYLE.SQUIGGLY) {
                        // We offset the dashes when the line is squiggly so as to pick the most
                        // aesthetically pleasing pattern. This is not in `CONSTANTS` because I feel
                        // it should be close to the `dash_pairs` settings.
                        const DASH_OFFSET = 4;
                        // The initial padding, free of squiggles.
                        dashes.push(total_width_of_tails + DASH_OFFSET);
                        dashes.push(0);
                        // We need to adjust the length of the line to restrict it to just the
                        // Bézier approximation.
                        arclen_line -= total_width_of_tails + total_width_of_heads - DASH_OFFSET;
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
                        if (this.style.body_style !== CONSTANTS.ARROW_BODY_STYLE.SQUIGGLY) {
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
                            .concat(new Array(Math.floor(dashes_and_gaps)).fill(dash_pairs).flat());
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
                        }
                        // We need to always end on an odd length of `dashes`, because the array
                        // indicates an alternating sequence of dashes and gaps.
                        if (dashes.length % 2 !== 1) {
                            dashes.push(0);
                        }

                    } else {
                        dashes = [arclen_line];
                        break;
                    }

                    if (this.style.body_style === CONSTANTS.ARROW_BODY_STYLE.SQUIGGLY) {
                        // The terminal padding, free of squiggles.
                        dashes.push(0);
                        dashes.push(total_width_of_heads);
                    }

                    break;
            }
        }

        const dash_array = `0 ${arclen_to_start} ${dashes.join(" ")} ${arclen - arclen_to_end}`;

        return { path, dash_array };
    }

    /// Redraw the heads or tails attached to an end of the edge.
    /// In general, we can draw arbitrary sequences of different arrowheads and they will compose
    /// nicely. However, we don't account for harpoons or hooks in combination with other arrowheads
    /// (even with others of the same kind), as I cannot see how to make these look good in
    /// combination. Thus, passing a non-singleton array containing "harpoon" or "hook" will likely
    /// have unexpected effects, as it has not been tested (likely defaulting to just drawing a
    /// harpoon or hook).
    /// Returns `{ path, total_width }`.
    redraw_heads(constants, heads, endpoint, is_start, is_mask) {
        // Note that, throughout, we use `head` as a contraction of `arrowhead`, which can be drawn
        // either at the tail (i.e. close to the source) or at the head of an arrow (i.e. close to
        // the target). This is confusing. Sorry.

        const {
            bezier, stroke_width, head_width, head_height, t_after_length, shorten, dash_padding,
            offset,
        } = constants;

        // Early return if we have no arrowheads.
        if (heads.length === 0) {
            return { path: null, total_width: 0 };
        }

        // The following two constants are used frequently to draw things at the correct end of the
        // edge, or with the correct orientation.
        const start_sign = is_start ? 1 : -1;
        // `ind`icates whether we are drawing at the end.
        const end_ind = is_start ? 0 : 1;

        // We draw all the arrowheads with a single path.
        const path = new Path();
        // The width of the combined arrowheads. This will be updated before the function returns.
        let total_width = 0;

        const arclen_to_endpoint = bezier.arc_length(endpoint.t)
            + (is_start ?
                shorten.start + this.style.shorten.tail :
                shorten.end + this.style.shorten.head
            ) * start_sign;

        if (includes_any(heads, "harpoon-top", "harpoon-bottom")) {
            // For 1-cells, it would arguably be more aesthetically-pleasing to centre harpoons on
            // their points (which is lower than their centre). However, unfortunately, we can't do
            // this consistently, because it starts to look odd for higher n-cells, as their centres
            // no longer line up, despite connecting two points in a straight line. Therefore, we
            // make do by keeping the centres aligned with the centre of the edge.
            const edge_bottom = stroke_width + CONSTANTS.LINE_SPACING;
            const side_sign
                = heads.find((head) => head.startsWith("harpoon")).endsWith("top") ? 1 : -1;
            const t = t_after_length(arclen_to_endpoint);
            const angle = bezier.tangent(t);
            const point = bezier.point(t)
                .add(offset)
                .add(new Point(
                    0,
                    side_sign * stroke_width / 2 - side_sign * CONSTANTS.STROKE_WIDTH / 2,
                ).rotate(angle));
            path.move_to(point);
            path.arc_by(
                new Point(start_sign * head_width, edge_bottom),
                angle,
                false,
                side_sign === 1 ? end_ind : 1 - end_ind,
                new Point(start_sign * head_width, -edge_bottom * side_sign).rotate(angle),
            );

            total_width = head_width;

            if (is_mask) {
                path.line_by(
                    Point.lendir(-start_sign * (head_width + CONSTANTS.MASK_PADDING), angle)
                );
                path.line_by(new Point(0, edge_bottom * side_sign).rotate(angle));
            }
        } else if (includes_any(heads, "hook-top", "hook-bottom")) {
            if (is_mask) {
                // We don't need masks for hooks, because they're simply drawn perfectly at the
                // ends.
                return { path: null, total_width: 0 };
            }

            const t = t_after_length(arclen_to_endpoint);
            const base_point = bezier.point(t);
            const angle = bezier.tangent(t);
            const side_sign
                = heads.find((head) => head.startsWith("hook")).endsWith("top") ? -1 : 1;
            // To avoid artefacts elsewhere, we mask a little overenthusiastically (see
            // `ENDPOINT_PADDING`). To avoid a line of transparent pixels, we adjust the tail here.
            const MASK_ADJUSTMENT = 0.5;
            // We draw a hook connecting to the ends of each of the n lines forming the n-cell.
            for (let i = 0; i < this.style.level; ++i) {
                const point = base_point
                    .add(offset)
                    .add(new Point(
                        MASK_ADJUSTMENT,
                        side_sign * stroke_width / 2
                            - side_sign * CONSTANTS.STROKE_WIDTH / 2
                            - side_sign * (CONSTANTS.LINE_SPACING + CONSTANTS.STROKE_WIDTH) * i,
                    ).rotate(angle));
                path.move_to(point);
                path.arc_by(
                    new Point(start_sign * head_width, head_width),
                    // We're drawing a semicircle, so the angle is *actually* unimportant.
                    angle,
                    // This argument appears to be unimportant.
                    false,
                    side_sign === 1 ? end_ind : 1 - end_ind,
                    new Point(0, side_sign * head_width * 2).rotate(angle),
                );
            }

            // Hooks are drawn at the end of edges and therefore aren't considered to take up any
            // space on the edge itself.
            total_width = 0;
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
                    case "corner-inverse":
                        [margin_left, margin_right, margin_begin] = [0, head_width, 0];
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

                total_width = heads_arclen + margin_left;
            }

            // Now we draw each head. We could combine this with the previous loop, but separate
            // out the two cases for readability.
            for (let i = heads.length - 1; i >= 0; --i) {
                // We only draw a mask for the arrowhead closest to the endpoint.
                if (is_mask && i !== 0) continue;

                const head_style = heads[i];
                const arclen_to_head = arclen_to_endpoint + arclens_to_head[i] * start_sign;
                const t = t_after_length(arclen_to_head);
                const point = bezier.point(t).add(offset);
                let angle = bezier.tangent(t);

                switch (head_style) {
                    case "mono":
                        angle += Math.PI;
                        // We intend to fall down into the "epi" branch: this is not an accidental
                        // mistake.
                    case "epi":
                        // Draw the two halves of the head.
                        for (const [side_sign, side_ind] of [[-1, end_ind], [1, 1 - end_ind]]) {
                            path.move_to(point);
                            path.arc_by(
                                new Point(start_sign * head_width, head_height / 2),
                                angle,
                                false,
                                side_ind,
                                new Point(start_sign * head_width, side_sign * head_height / 2)
                                    .rotate(angle),
                            );
                            if (is_mask) {
                                let distance;
                                switch (head_style) {
                                    case "epi":
                                        distance
                                            = -start_sign * (head_width + CONSTANTS.MASK_PADDING);
                                        break;
                                    case "mono":
                                        // We have to pad the mask for "mono" for the same reason we
                                        // add `dash_padding`. In this case, we have to add twice as
                                        // much, because the padding is added everywhere, even where
                                        // it is not needed, so we need to make sure we cover it
                                        // with the mask.
                                        const padding
                                            = (is_start ? dash_padding.start : dash_padding.end)
                                                * 2;
                                        distance = start_sign * (CONSTANTS.MASK_PADDING + padding);
                                        break;
                                }
                                path.line_by(Point.lendir(distance, angle));
                                path.line_by(
                                    new Point(0, -side_sign * head_height / 2).rotate(angle)
                                );
                            }
                        }
                        break;

                    // The corner symbol used for pullbacks and pushouts.
                    case "corner":
                    case "corner-inverse":
                        const is_inverse = head_style.endsWith("-inverse");
                        const LENGTH = 12;
                        const base_2 = LENGTH / (2 ** 0.5);
                        const base_point
                            = bezier.point(t_after_length(
                                arclen_to_head + (is_inverse ? 0 : base_2 * start_sign)
                            )).add(offset);

                        // Draw the two halves of the head.
                        for (const side_sign of [-1, 1]) {
                            path.move_to(base_point);

                            // Round the angle to the nearest 45º and adjust with respect to the
                            // current direction.
                            const PI_4 = Math.PI / 4;
                            const direction = this.target.origin.sub(this.source.origin).angle();
                            const corner_angle
                                = (is_inverse ? 0 : Math.PI)
                                    + PI_4 * Math.round(4 * direction / Math.PI) - direction;

                            path.line_by(Point.lendir(
                                LENGTH,
                                corner_angle + Math.PI * end_ind + side_sign * Math.PI / 4,
                            ));
                        }
                        break;

                    case "maps to":
                        path.move_to(point.add(Point.lendir(head_height / 2, angle + Math.PI / 2)));
                        path.line_by(Point.lendir(head_height, angle - Math.PI / 2));
                        break;
                }
            }
        }

        return {
            path: new DOM.SVGElement("path", {
                class: "arrow-head",
                d: `${path}`,
                mask: !is_mask ? `url(#arrow${this.id}-label-clipping-mask)` : null,
                fill: is_mask ? "black" : "none",
                stroke: !is_mask ? this.style.colour : "none",
                "stroke-width": CONSTANTS.STROKE_WIDTH,
                "stroke-linecap": "round",
            }),
            total_width,
        };
    }

    /// Redraw the label attached to the edge. Returns the mask associated to the label.
    redraw_label(constants, tag_name) {
        const { angle, offset } = constants;

        const origin = this.determine_label_position(constants).add(offset).sub(new Point(
            this.label.size.width / 2,
            this.label.size.height / 2,
        ));

        // Draw the mask.
        return new DOM.SVGElement(tag_name, {
            width: this.label.size.width,
            height: this.label.size.height,
            fill: "black",
            x: 0,
            y: 0,
            transform: `translate(${origin.x} ${origin.y}) ${
                // The label should be horizontal for most alignments, but in the direction of the
                // arrow for `OVER`.
                this.label.alignment === CONSTANTS.LABEL_ALIGNMENT.OVER ? "" :
                    `rotate(${-rad_to_deg(angle)} ${
                        this.label.size.width / 2} ${this.label.size.height / 2})`
            }`,
        });
    }

    /// Find the correct position of the label. If the label is centred, this is easy. However, if
    /// it is offset to either side, we want to find the minimum offset from the centre of the edge
    /// such that the label no longer overlaps the edge.
    determine_label_position(constants) {
        const { length, angle, edge_width, start, end } = constants;

        const bezier = new Bezier(Point.zero(), length, this.style.curve, angle);
        const centre = bezier.point(start.t + (end.t - start.t) * this.style.label_position);

        // The angle we will try to push the label so that it no longer intersects the curve. This
        // will be set by the following switch block if we do not return by the end of the block.
        let offset_angle;

        switch (this.label.alignment) {
            case CONSTANTS.LABEL_ALIGNMENT.CENTRE:
            case CONSTANTS.LABEL_ALIGNMENT.OVER:
                return centre;

            case CONSTANTS.LABEL_ALIGNMENT.LEFT:
                offset_angle = -Math.PI / 2;
                break;

            case CONSTANTS.LABEL_ALIGNMENT.RIGHT:
                offset_angle = Math.PI / 2;
                break;
        }

        // To offset the label bounding rectangle properly, we're going to iterately approximate its
        // location. We first normalise the Bézier curve (flat Bézier curves must be special-cased).
        // We then find all the intersections of the bounding rectangle with the curve: we want the
        // number of intersections to be zero. To find this distance, we do a binary search (between
        // 0 and the height of the curve plus the label size). We also add padding to the bounding
        // rectangle to simulate the thickness of the curve.

        // Unfortunately, floating-point calculations aren't precise, so we need to add some leeway
        // here, otherwise we sometimes encounter situations where `offset_max` isn't quite
        // sufficient.
        const OFFSET_ALLOWANCE = 4;
        let offset_min = 0;
        let offset_max = OFFSET_ALLOWANCE + Math.abs(this.style.curve) / 2
            + this.label.size.add(Point.diag(edge_width)).div(2).length();
        // The following variable will be initialised by the following loop, which runs at least
        // once.
        let label_offset;

        const BAIL_OUT = 1024;
        let i = 0;
        while (true) {
            // We will try offseting at distance `label_offset` pixels next.
            label_offset = (offset_min + offset_max) / 2;
            const rect_centre = centre
                .rotate(angle)
                .add(Point.lendir(label_offset, angle + offset_angle));
            // Compute the intersections between the offset bounding rectangle and the edge.
            const intersections = bezier
                .intersections_with_rounded_rectangle(new RoundedRectangle(
                    rect_centre,
                    this.label.size.add(Point.diag(edge_width)),
                    edge_width / 2,
                ), true);

            if (intersections.length === 0) {
                // If we've determined the offset to a sufficiently-high precision, we can stop
                // here, as this offset is sufficient.
                if (offset_max - offset_min < 1) {
                    break;
                }
                // Otherwise, we update the bounds to narrow down on the right offset.
                [offset_min, offset_max] = [offset_min, label_offset];
            } else {
                [offset_min, offset_max] = [label_offset, offset_max];
            }

            if (++i >= BAIL_OUT) {
                // Reaching this case is an error: we should always be able to find an offset that
                // has no intersection. However, it's better to bail out if there's a mistake, than
                // to cause an infinite loop.
                console.error("Had to bail out from determining label offset.");
                break;
            }
        }

        return centre.add(Point.lendir(label_offset, offset_angle));
    }
}

Arrow.NEXT_ID = 0;
