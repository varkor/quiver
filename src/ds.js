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

// `h` ranges from `0` to `360`.
// `s` ranges from `0` to `1`.
// `l` ranges from `0` to `1`.
function hsl_to_rgb(h, s, l) {
    // Algorithm source: https://en.wikipedia.org/wiki/HSL_and_HSV#HSL_to_RGB_alternative.
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
        const k = (n + h / 30) % 12;
        return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    }
    return [f(0) * 255, f(8) * 255, f(4) * 255];
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
    constructor(h, s, l, a) {
        super();
        [this.h, this.s, this.l, this.a] = [h, s, l, a];
    }

    static black() {
        return new Colour(0, 0, 0, 1);
    }

    hsla() {
        return [this.h, this.s, this.l, this.a];
    }

    toJSON() {
        return this.hsla();
    }

    eq(other) {
        return this.h === other.h && this.s === other.s && this.l === other.l && this.a === other.a
            || this.l === 0 && other.l === 0 || this.l === 100 && other.l === 100;
    }

    is_not_black() {
        return this.l > 0;
    }
}
