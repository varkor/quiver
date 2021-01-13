"use strict";

/// An enumeration type.
class Enum {
    constructor(name, ...variants) {
        for (const variant of variants) {
            this[variant] = Symbol(`${name}::${variant}`);
        }
    }
}

/// A quintessential 2D (x, y) point.
class Point {
    constructor(x, y) {
        [this.x, this.y] = [x, y];
    }

    static zero() {
        return new this(0, 0);
    }

    static lendir(length, direction) {
        return new this(Math.cos(direction) * length, Math.sin(direction) * length);
    }

    static diag(x) {
        return new this(x, x);
    }

    toString() {
        return `${this.x} ${this.y}`;
    }

    toArray() {
        return [this.x, this.y];
    }

    px(comma = true) {
        return `${this.x}px${comma ? "," : ""} ${this.y}px`;
    }

    eq(other) {
        return this.x === other.x && this.y === other.y;
    }

    add(other) {
        return new (this.constructor)(this.x + other.x, this.y + other.y);
    }

    sub(other) {
        return new (this.constructor)(this.x - other.x, this.y - other.y);
    }

    neg() {
        return new (this.constructor)(-this.x, -this.y);
    }

    scale(w, h) {
        return new (this.constructor)(this.x * w, this.y * h);
    }

    inv_scale(w, h) {
        return new (this.constructor)(this.x / w, this.y / h);
    }

    mul(multiplier) {
        return this.scale(multiplier, multiplier);
    }

    div(divisor) {
        return this.inv_scale(divisor, divisor);
    }

    max(other) {
        return new (this.constructor)(Math.max(this.x, other.x), Math.max(this.y, other.y));
    }

    min(other) {
        return new (this.constructor)(Math.min(this.x, other.x), Math.min(this.y, other.y));
    }

    rotate(theta) {
        return new (this.constructor)(
            this.x * Math.cos(theta) - this.y * Math.sin(theta),
            this.y * Math.cos(theta) + this.x * Math.sin(theta),
        );
    }

    length() {
        return Math.hypot(this.y, this.x);
    }

    angle() {
        return Math.atan2(this.y, this.x);
    }

    lerp(other, t) {
        return this.add(other.sub(this).mul(t));
    }

    is_zero() {
        return this.x === 0 && this.y === 0;
    }
}

/// Equivalent to `Point`, but used semantically to refer to a position (in cell indices)
/// on the canvas.
class Position extends Point {}

/// Equivalent to `Point`, but used semantically to refer to a position (in pixels) on the canvas.
class Offset extends Point {}

/// An (width, height) pair. This is essentially functionally equivalent to `Point`,
/// but has different semantic intent.
const Dimensions = class extends Position {
    get width() {
        return this.x;
    }

    get height() {
        return this.y;
    }
};

/// Convert radians to degrees.
function rad_to_deg(rad) {
    return rad * 180 / Math.PI;
}

/// Convert degrees to radians.
function deg_to_rad(deg) {
    return deg * Math.PI / 180;
}

/// A class for conveniently generating and manipulating SVG paths.
class Path {
    constructor() {
        this.commands = [];
    }

    toString() {
        return this.commands.join("\n");
    }

    move_to(p) {
        this.commands.push(`M ${p.x} ${p.y}`);
        return this;
    }

    line_to(p) {
        this.commands.push(`L ${p.x} ${p.y}`);
        return this;
    }

    line_by(p) {
        this.commands.push(`l ${p.x} ${p.y}`);
        return this;
    }

    curve_by(c, d) {
        this.commands.push(`q ${c.x} ${c.y} ${d.x} ${d.y}`);
        return this;
    }

    arc_by(r, angle, large_arc, clockwise, next) {
        this.commands.push(
            `a ${r.x} ${r.y}
            ${rad_to_deg(angle)} ${large_arc ? 1 : 0} ${clockwise ? 1 : 0}
            ${next.x} ${next.y}`
        );
        return this;
    }
}

function clamp(min, x, max) {
    return Math.max(min, Math.min(x, max));
}

function arrays_equal(array1, array2) {
    if (array1.length !== array2.length) {
        return false;
    }

    for (let i = 0; i < array1.length; ++i) {
        if (array1[i] !== array2[i]) {
            return false;
        }
    }

    return true;
}

// A type with custom JSON encoding.
class Encodable {
    eq(/* other */) {
        console.error("`eq` must be implemented for each subclass.");
    }
}

class Colour extends Encodable {
    constructor(h, s, l, a = 1, name = Colour.colour_name([h, s, l, a])) {
        super();
        [this.h, this.s, this.l, this.a] = [h, s, l, a];
        this.name = name;
    }

    static black() {
        return new Colour(0, 0, 0);
    }

    /// Returns a standard colour name associated to the `[h, s, l, a]` value, or `null` if none
    /// exists. Currently, this is only used to associate tooltips to colours swatches in the UI.
    static colour_name(hsla) {
        const [h, s, l, a] = hsla;
        if (a === 0) {
            return "transparent";
        }
        if (a === 1 && l === 0) {
            return "black";
        }
        if (a === 1 && l === 100) {
            return "white";
        }

        switch (`${h}, ${s}, ${l}, ${a}`) {
            // Most of the following colours match the CSS colour names. Those that do not have (*)
            // next to them.
            case "0, 100, 50, 1":
                return "red";
            case "30, 100, 50, 1":
                return "orange"; // (*)
            case "60, 100, 50, 1":
                return "yellow";
            case "120, 100, 50, 1":
                return "green";
            case "180, 100, 50, 1":
                return "aqua";
            case "240, 100, 50, 1":
                return "blue";
            case "270, 100, 50, 1": // (*)
                return "purple";
            case "300, 100, 50, 1":
                return "magenta";
            // The following do not match CSS colour names.
            case "0, 60, 60, 1":
                return "red chalk";
            case "30, 60, 60, 1":
                return "orange chalk";
            case "60, 60, 60, 1":
                return "yellow chalk";
            case "120, 60, 60, 1":
                return "green chalk";
            case "180, 60, 60, 1":
                return "aqua chalk";
            case "240, 60, 60, 1":
                return "blue chalk";
            case "270, 60, 60, 1":
                return "purple chalk";
            case "300, 60, 60, 1":
                return "magenta chalk";
        }
        return null;
    }

    hsla() {
        return [this.h, this.s, this.l, this.a];
    }

    rgba() {
        // Algorithm source: https://en.wikipedia.org/wiki/HSL_and_HSV#HSL_to_RGB_alternative.
        const [h, s, l] = [this.h, this.s / 100, this.l / 100];
        const a = s * Math.min(l, 1 - l);
        const f = (n) => {
            const k = (n + h / 30) % 12;
            return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        }
        return [f(0) * 255, f(8) * 255, f(4) * 255, this.a].map((x) => Math.round(x));
    }

    /// `r`, `g`, `b` are expected to take values in `0` to `255`.
    static from_rgba(r, g, b, a = 1) {
        // Algorithm source: https://en.wikipedia.org/wiki/HSL_and_HSV#Formal_derivation
        [r, g, b] = [r, g, b].map((x) => x / 255);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const range = max - min;
        let h = 0; // Default hue (if undefined).
        if (range !== 0) {
            switch (max) {
                case r:
                    h = ((g - b) / range) % 6;
                    break;
                case g:
                    h = ((b - r) / range) + 2;
                    break;
                case b:
                    h = ((r - g) / range) + 4;
                    break;
            }
        }
        const l = (max + min) / 2;
        const s = l === 0 || l === 1 ? 0 : range / (1 - Math.abs(2 * l - 1));

        return new Colour(...[h * 60, s * 100, l * 100].map((x) => Math.round(x)), a);
    }

    toJSON() {
        if (this.a === 1) {
            // For now, every colour has no transparency; even in the future, most
            // arrows will be fully opaque, so no point encoding the `1` every time.
            return [this.h, this.s, this.l];
        } else {
            return this.hsla();
        }
    }

    toString() {
        return `${this.h},${this.s},${this.l},${this.a}`;
    }

    css() {
        return `hsla(${this.h}, ${this.s}%, ${this.l}%, ${this.a})`;
    }

    /// Returns the LaTeX code corresponding to a HSL colour.
    latex(latex_colours, parenthesise = false) {
        // If the colour has a specific name in LaTeX (e.g. because it is predefined, or has been
        // imported), use that.
        let latex_name = null;
        const name = Colour.colour_name(this.hsla());
        if (["black", "red", "green", "blue", "white"].includes(name)) {
            latex_name = name;
        } else {
            // We currently eagerly pick whichever LaTeX colour matches this one. This means that if
            // there are multiple names for the same colour, we may not pick the correct one. It
            // would be possible to correct this by saving colour names, rather than just colour
            // values.
            for (const [name, colour] of latex_colours) {
                if (colour.eq(this)) {
                    latex_name = name;
                    break;
                }
            }
        }
        if (latex_name !== null) {
            return parenthesise ? `{${latex_name}}` : latex_name;
        }

        // Otherwise, fall back to a colour code.
        // Alpha is currently not supported.
        const [r, g, b, /* a */] = this.rgba();
        return `{rgb,255:red,${r};green,${g};blue,${b}}`;
    }

    /// Returns whether two colours are equal, ignoring names.
    eq(other) {
        return this.h === other.h && this.s === other.s && this.l === other.l && this.a === other.a
            || this.l === 0 && other.l === 0 || this.l === 100 && other.l === 100;
    }

    is_not_black() {
        return this.l > 0;
    }
}

// Returns a `Map` containing the current URL's query parameters.
function query_parameters() {
    const query_string = window.location.href.match(/\?(.*)$/);
    if (query_string !== null) {
        // If there is `q` parameter in the query string, try to decode it as a diagram.
        const query_segs = query_string[1].split("&");
        const query_data = new Map(query_segs.map(segment => segment.split("=")));
        return query_data;
    }
    return new Map();
}
