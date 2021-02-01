"use strict";

window.addEventListener("DOMContentLoaded", (event) => {
    // Set nice style defaults for embedded diagrams.
    for (embed of document.querySelectorAll(".quiver-embed iframe")) {
        embed.style.border = "none";
        embed.style.borderRadius = "5px";
        embed.style.overflow = "hidden";
    }
});
