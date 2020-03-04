"use strict";

/// An enumeration type.
class Enum {
    constructor(name, ...variants) {
        for (const variant of variants) {
            this[variant] = Symbol(`${name}::${variant}`);
        }
    }
}

/// A quintessential (x, y) position.
class Position {
    constructor(x, y) {
        [this.x, this.y] = [x, y];
    }

    static zero() {
        return new Position(0, 0);
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

    div(divisor) {
        return new (this.constructor)(this.x / divisor, this.y / divisor);
    }

    min(other) {
        return new (this.constructor)(Math.min(this.x, other.x), Math.min(this.y, other.y));
    }

    max(other) {
        return new (this.constructor)(Math.max(this.x, other.x), Math.max(this.y, other.y));
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
    /// Returns a `Dimensions` with `{ width: 0, height: 0}`.
    static zero() {
        return new Dimensions(0, 0);
    }

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

    as_dim() {
        return new Dimensions(this.left, this.top);
    }

    /// Moves an `element` to the offset.
    reposition(element) {
        [element.style.left, element.style.top] = this.to_CSS();
    }

    add(other) {
        return new (this.constructor)(this.left + other.left, this.top + other.top);
    }

    sub(other) {
        return new (this.constructor)(this.left - other.left, this.top - other.top);
    }

    neg() {
        return new (this.constructor)(-this.left, -this.top);
    }

    div(divisor) {
        return new (this.constructor)(this.left / divisor, this.top / divisor);
    }

    min(other) {
        return new (this.constructor)(
            Math.min(this.left, other.left),
            Math.min(this.top, other.top)
        );
    }

    max(other) {
        return new (this.constructor)(
            Math.max(this.left, other.left),
            Math.max(this.top, other.top)
        );
    }

    length() {
        return Math.hypot(this.left, this.top);
    }

    angle() {
        return Math.atan2(this.top, this.left);
    }
}
