import {VirtualRepeater} from '../virtual-repeater.js';
import {directive, NodePart} from '../../lit-html/lit-html.js';

export const LitMixin = Superclass => class extends Superclass {
    constructor() {
        super();

        this._template = null;        
        this._hostPart = null;
        this._recycle = false;
        this._recycledParts = [];
    }

    set part(part) {
        this._hostPart = part;
        this._computeContainer(true);
    }

    set template(template) {
        if (template !== this._template) {
            this._template = template;
            this._needsReset = true;
            this._needsRender = true;
        }
    }

    set recycle(recycle) {
        recycle = Boolean(recycle);
        if (recycle !== this._recycle) {
            this._recycle = recycle;
            this._needsReset = true;
            this._needsRender = true;
        }
    }

    _computeContainer(canRetry) {
        const container = this._hostPart.startNode.parentNode;
        // If not attached yet, wait a tick to allow
        // DOM to be attached in the document.
        if (container.parentNode || container.host) {
            this.container = container;
        } else if (canRetry) {
            // Retry only once.
            Promise.resolve().then(() => this._computeContainer(false));
        } else {
            throw Error`container not connected to the main document`;
        }
    }

    // Lit-specific overrides for node manipulation
    get _kids() {
        return this._ordered.map(p => p.startNode.nextElementSibling);
    }

    _node(part) {
        return part.startNode;
    }

    _nextSibling(part) {
        return part.endNode.nextSibling;
    }

    _insertBefore(part, referenceNode) {
        if (referenceNode === null) {
            referenceNode = this._hostPart.endNode;
        }
        const container = this._container;
        if (!this._childIsAttached(part)) {
            // Inserting new part
            part.startNode = document.createTextNode('');
            part.endNode = document.createTextNode('');
            container.insertBefore(part.startNode, referenceNode);
            container.insertBefore(part.endNode, referenceNode);
        }
        else {
            // Inserting existing part
            const boundary = part.endNode.nextSibling;
            if (referenceNode !== part.startNode && referenceNode !== boundary) {
                // Part is not already in the right place
                for (let node = part.startNode; node !== boundary;) {
                    const n = node.nextSibling;
                    container.insertBefore(node, referenceNode);
                    node = n;
                }
            }
        }
    }

    _childIsAttached(part) {
        return Boolean(part.startNode);
    }

    _hideChild(part) {
        for (let node = part.startNode.nextSibling; node !== part.endNode;) {
            if (node.style) {
                node.style.display = 'none';
            }
            node = node.nextSibling;
        }
    }

    _showChild(part) {
        if (this._childIsAttached(part)) {
            for (let node = part.startNode.nextSibling; node !== part.endNode;) {
                if (node.style) {
                    node.style.display = null;
                }
                node = node.nextSibling;
            }                
        }
    }

    __removeChild(part) {
        if (this._recycle) {
            this._recycledParts.push(part);
            return;
        }
        let node = part.startNode.nextSibling;
        while (node !== part.endNode) {
            const next = node.nextSibling;
            this._container.removeChild(node);
            node = next;
        }    
    }

    //

    _getNewChild() {
        const recycled = this._recycle ? this._recycledParts.pop() : null;
        return recycled || new NodePart(this._hostPart.instance, null, null);
    }

    _updateChild(part, item, idx) {
        part.setValue(this._template(item, idx));
    }
}

export const LitRepeater = LitMixin(VirtualRepeater);

const partToRepeater = new WeakMap();
export const repeat = (config = {}) => directive(part => {
    let repeater = partToRepeater.get(part);
    if (!repeater) {
        repeater = new LitRepeater();
        partToRepeater.set(part, repeater);
    }
    Object.assign(config, {
        part,
        // Assign template only once.
        template: repeater.template || config.template,
    });
    Object.assign(repeater, config);
});