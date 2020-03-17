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

    static from_length_and_direction(length, direction) {
        return new this(Math.cos(direction) * length, Math.sin(direction) * length);
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

/// Equivalent to `Point`, but used semantically to refer to a position on the canvas.
class Position extends Point {}

/// An (width, height) pair. This is essentially functionally equivalent to `Point`,
/// but has different semantic intent.
const Dimensions = class extends Position {
    /// Returns a `Dimensions` with the same width and height.
    static diag(x) {
        return new Dimensions(x, x);
    }

    get width() {
        return this.x;
    }

    get height() {
        return this.y;
    }
};

/// An HTML position. This is functionally equivalent to `Position`, but has different semantic
/// intent.
class Offset extends Point {
    get left() {
        return this.x;
    }

    get top() {
        return this.y;
    }

    set left(left) {
        this.x = left;
    }

    set top(top) {
        this.y = top;
    }

    /// Return a [left, top] arrow of CSS length values.
    to_CSS() {
        return [`${this.left}px`, `${this.top}px`];
    }

    as_dim() {
        return new Dimensions(this.left, this.top);
    }

    /// Moves an `element` to the offset.
    reposition(element) {
        [element.style.left, element.style.top] = this.to_CSS();
    }
}

/// A class for conveniently generating and manipulating SVG paths.
class Path {
    constructor() {
        this.commands = [];
    }

    toString() {
        return this.commands.join("\n");
    }

    move_to(x, y) {
        this.commands.push(`M ${x} ${y}`);
    }

    line_to(x, y) {
        this.commands.push(`L ${x} ${y}`);
    }

    line_by(x, y) {
        this.commands.push(`l ${x} ${y}`);
    }

    arc_by(rx, ry, angle, large_arc, clockwise, next_x, next_y) {
        this.commands.push(
            `a ${rx} ${ry} ${angle} ${large_arc ? 1 : 0} ${clockwise ? 1 : 0} ${next_x} ${next_y}`
        );
    }
}
