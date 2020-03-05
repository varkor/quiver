"use strict";

/// A helper object for dealing with the DOM.
const DOM = {};

/// A class for conveniently dealing with elements. It's primarily useful in giving us a way to
/// create an element and immediately set properties and styles, in a single statement.
DOM.Element = class {
    /// `from` has two forms: a plain string, in which case it is used as a `tagName` for a new
    /// element, or an existing element, in which case it is wrapped in a `DOM.Element`.
    constructor(from, attributes = {}, style = {}, namespace = null) {
        if (typeof from !== "string") {
            this.element = from;
        } else if (namespace !== null) {
            this.element = document.createElementNS(namespace, from);
        } else {
            this.element = document.createElement(from);
        }
        for (const [attribute, value] of Object.entries(attributes)) {
            this.element.setAttribute(attribute, value);
        }
        Object.assign(this.element.style, style);
    }

    get id() {
        return this.element.id;
    }

    get class_list() {
        return this.element.classList;
    }

    /// Appends an element.
    /// `value` has two forms: a plain string, in which case it is added as a text node, or a
    /// `DOM.Element`, in which case the corresponding element is appended.
    add(value) {
        if (typeof value !== "string") {
            this.element.appendChild(value.element);
        } else {
            this.element.appendChild(document.createTextNode(value));
        }
        return this;
    }

    /// Removes the element from the DOM.
    remove() {
        this.element.remove();
    }

    /// Adds an event listener.
    listen(type, f) {
        this.element.addEventListener(type, event => f(event, this.element));
        return this;
    }

    /// Removes all children from the element.
    clear() {
        while (this.element.firstChild !== null) {
            this.element.firstChild.remove();
        }
        return this;
    }

    query_selector(selector) {
        return this.element.querySelector(selector);
    }
};

/// A class for conveniently dealing with SVGs.
DOM.SVGElement = class extends DOM.Element {
    constructor(tag_name, attributes = {}, style = {}) {
        super(tag_name, attributes, style, "http://www.w3.org/2000/svg");
    }
};

/// A class for conveniently dealing with canvases.
DOM.Canvas = class extends DOM.Element {
    constructor(from, width, height, attributes = {}, style = {}) {
        super(from || "canvas", attributes, style);
        this.context = this.element.getContext("2d");
        if (from === null) {
            this.resize(width, height);
        }
        this.context.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    }

    /// Resizes and clears the canvas.
    resize(width, height) {
        const dpr = window.devicePixelRatio;
        // Only resize the canvas when necessary.
        if (width * dpr !== this.element.width || height * dpr != this.element.height) {
            this.element.width = width * dpr;
            this.element.height = height * dpr;
            this.element.style.width = `${width}px`;
            this.element.style.height = `${height}px`;
            this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
        } else {
            this.context.clearRect(0, 0, width, height);
        }
    }
}
