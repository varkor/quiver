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
