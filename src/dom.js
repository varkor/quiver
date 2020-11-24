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
        this.set_attributes(attributes);
        this.set_style(style);
    }

    get id() {
        return this.element.id;
    }

    get class_list() {
        return this.element.classList;
    }

    get parent() {
        return new DOM.Element(this.element.parentElement);
    }

    /// Appends an element.
    /// `value` has three forms: a plain string, in which case it is added as a text node; a
    /// `DOM.Element`, in which case the corresponding element is appended; or a plain element.
    add(value) {
        if (value instanceof DOM.Element) {
            this.element.appendChild(value.element);
        } else if (typeof value !== "string") {
            this.element.appendChild(value);
        } else {
            this.element.appendChild(document.createTextNode(value));
        }
        return this;
    }

    /// Appends this element to the given one.
    add_to(value) {
        if (value instanceof DOM.Element) {
            value.element.appendChild(this.element);
        } else {
            value.appendChild(this.element);
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
        const element = this.element.querySelector(selector);
        if (element !== null) {
            return new DOM.Element(element);
        } else {
            return null;
        }
    }

    query_selector_all(selector) {
        const elements = Array.from(this.element.querySelectorAll(selector));
        return elements.map((element) => new DOM.Element(element));
    }

    get_attribute(attribute) {
        return this.element.getAttribute(attribute);
    }

    set_attributes(attributes = {}) {
        for (const [attribute, value] of Object.entries(attributes)) {
            if (value !== null) {
                this.element.setAttribute(attribute, value);
            } else {
                this.element.removeAttribute(attribute);
            }
        }
        return this;
    }

    remove_attributes(...attributes) {
        for (const attribute of attributes) {
            this.element.removeAttribute(attribute);
        }
        return this;
    }

    set_style(style = {}) {
        Object.assign(this.element.style, style);
    }

    clone() {
        return new DOM.Element(this.element.cloneNode());
    }

    bounding_rect() {
        return this.element.getBoundingClientRect();
    }
};

/// A class for conveniently dealing with SVGs.
DOM.SVGElement = class extends DOM.Element {
    constructor(tag_name, attributes = {}, style = {}) {
        super(tag_name, attributes, style, DOM.SVGElement.NAMESPACE);
    }
};
DOM.SVGElement.NAMESPACE = "http://www.w3.org/2000/svg";

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

/// A class for conveniently dealing with tables.
DOM.Table = class extends DOM.Element {
    constructor(rows, attributes = {}, style = {}) {
        super("table", attributes, style);

        for (const row of rows) {
            const tr = new DOM.Element("tr").add_to(this);
            for (const value of row) {
                const td = new DOM.Element("td").add_to(tr);
                if (typeof value === "function") {
                    value(td);
                } else {
                    td.add(value);
                }
            }
        }
    }
};

/// A class for conveniently dealing with lists.
DOM.List = class extends DOM.Element {
    constructor(ordered = true, items, attributes = {}, style = {}) {
        super(ordered ? "ol" : "ul", attributes, style);

        for (let item of items) {
            // Wrap in `<li>` if necessary.
            if (!(item instanceof DOM.Element) || item.element.className !== "li") {
                item = new DOM.Element("li").add(item);
            }
            this.add(item);
        }
    }
};

// A class for conveniently dealing with hyperlinks.
DOM.Link = class extends DOM.Element {
    constructor(url, content, new_tab = false, attributes = {}, style = {}) {
        super("a", Object.assign({ href: url }, attributes), style);
        if (new_tab) {
            this.set_attributes({ target: "_blank" });
        }
        this.add(content);
    }
};
