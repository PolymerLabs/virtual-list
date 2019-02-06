function composedTreeParent(node) {
  return node.assignedSlot || node.host || node.parentNode;
}

function nearestScrollingAncestor(node) {
  for (node = composedTreeParent(node); node !== null; node = composedTreeParent(node)) {
    if (node.nodeType === Node.ELEMENT_NODE && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return null;
}

const DEFAULT_HEIGHT_ESTIMATE = 100;
const TEMPLATE = `
<style>
:host {
  /* Use flex to prevent children's margins from collapsing. Avoiding margin
   * collapsing is simpler and good enough to start with. */
  display: flex;
  flex-direction: column;

  /* Prevent the automatic scrolling between writes and later measurements,
   * which can invalidate previous layout. */
  overflow-anchor: none;
}

#emptySpaceSentinelContainer {
  contain: size layout style;
  pointer-events: none;
  visibility: hidden;
  overflow: visible;
  position: relative;
  height: 0px;
}

#emptySpaceSentinelContainer > div {
  contain: strict;
  position: absolute;
  width: 100%;
}

::slotted(*) {
  flex: 0 0 auto !important;
  display: block !important;
  position: relative !important;
}
</style>
<div id="emptySpaceSentinelContainer"></div>
<slot></slot>
`;

const _intersectionObserver = Symbol('_intersectionObserver');
const _mutationObserver = Symbol('_mutationObserver');
const _resizeObserver = Symbol('_resizeObserver');
const _estimatedHeights = Symbol('_estimatedHeights');
const _updateRAFToken = Symbol('_updateRAFToken');
const _emptySpaceSentinelContainer = Symbol('_emptySpaceSentinelContainer');

const _intersectionObserverCallback = Symbol('_intersectionObserverCallback');
const _mutationObserverCallback = Symbol('_mutationObserverCallback');
const _resizeObserverCallback = Symbol('_resizeObserverCallback');
const _onActivateinvisible = Symbol('_onActivateinvisible');
const _scheduleUpdate = Symbol('_scheduleUpdate');
const _update = Symbol('_update');

export class VirtualContent extends HTMLElement {
  constructor() {
    super();

    [
      _intersectionObserverCallback,
      _mutationObserverCallback,
      _resizeObserverCallback,
      _onActivateinvisible,
      _scheduleUpdate,
      _update,
    ].forEach(x => this[x] = this[x].bind(this));

    const shadowRoot = this.attachShadow({mode: 'closed'});

    shadowRoot.innerHTML = TEMPLATE;

    this[_intersectionObserver] =
        new IntersectionObserver(this[_intersectionObserverCallback]);
    this[_mutationObserver] =
        new MutationObserver(this[_mutationObserverCallback]);
    this[_resizeObserver] = new ResizeObserver(this[_resizeObserverCallback]);
    this[_estimatedHeights] = new WeakMap();
    this[_updateRAFToken] = undefined;
    this[_emptySpaceSentinelContainer] =
        shadowRoot.getElementById('emptySpaceSentinelContainer');

    this[_intersectionObserver].observe(this);
    // Send a MutationRecord-like object with the current, complete list of
    // child nodes to the MutationObserver callback; these nodes would not
    // otherwise be seen by the observer.
    this[_mutationObserverCallback]([
      {
        type: 'childList',
        target: this,
        addedNodes: Array.from(this.childNodes),
        removedNodes: [],
        previousSibling: null,
        nextSibling: null,
      }
    ]);
    this[_mutationObserver].observe(this, {childList: true});

    this.addEventListener(
        'activateinvisible', this[_onActivateinvisible], {capture: true});
  }

  [_intersectionObserverCallback](entries) {
    for (const { target, isIntersecting } of entries) {

      // Update if the <virtual-content> has moved into or out of the viewport.
      if (target === this) {
        this[_scheduleUpdate]();
        break;
      }

      const targetParent = target.parentNode;

      // Update if an empty space sentinel has moved into the viewport.
      if (targetParent === this[_emptySpaceSentinelContainer] && isIntersecting) {
        this[_scheduleUpdate]();
        break;
      }

      // Update if a child has moved out of the viewport.
      if (targetParent === this && !isIntersecting) {
        this[_scheduleUpdate]();
        break;
      }
    }
  }

  [_mutationObserverCallback](records) {
    const estimatedHeights = this[_estimatedHeights];

    for (const record of records) {
      for (const node of record.removedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Removed children should have be made visible again; they're no
          // longer under our control.
          this[_resizeObserver].unobserve(node);
          this[_intersectionObserver].unobserve(node);
          node.removeAttribute('invisible');
          estimatedHeights.delete(node);
        }
      }

      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Added children should be invisible initially.
          node.setAttribute('invisible', '');
          estimatedHeights.set(node, DEFAULT_HEIGHT_ESTIMATE);
        } else {
          // Remove non-element children because we can't control their
          // invisibility state or even prevent them from being rendered using
          // CSS (they aren't distinctly selectable).

          // These records are not coalesced, so test that the node is actually
          // a child of this node before removing it.
          if (node.parentNode === this) {
            this.removeChild(node);
          }
        }
      }
    }

    this[_scheduleUpdate]();
  }

  [_resizeObserverCallback]() {
    this[_scheduleUpdate]();
  }

  [_onActivateinvisible](e) {
    // Find the child containing the target and synchronously update, forcing
    // that child to be visible. The browser will automatically scroll to that
    // element because it is visible, which will trigger another update to make
    // the surrounding nodes visible.
    let child = e.target;
    while (child.parentNode !== this) {
      child = child.parentNode;
    }
    this[_update](child);
  }

  [_scheduleUpdate]() {
    if (this[_updateRAFToken] !== undefined) return;

    this[_updateRAFToken] = window.requestAnimationFrame(this[_update]);
  }

  [_update](childToForceVisible) {
    this[_updateRAFToken] = undefined;

    const thisClientRect = this.getBoundingClientRect();
    // Don't read or store layout information if the <virtual-content> isn't in a
    // renderable state (e.g. disconnected, invisible, `display: none`, etc.).
    const isRenderable =
      thisClientRect.top !== 0 ||
      thisClientRect.left !== 0 ||
      thisClientRect.width !== 0 ||
      thisClientRect.height !== 0;

    const estimatedHeights = this[_estimatedHeights];
    const getAndUpdateHeightEstimate = (child) => {
      if (isRenderable && !child.hasAttribute('invisible')) {
        const childClientRect = child.getBoundingClientRect();
        const style = window.getComputedStyle(child);
        const height =
          window.parseFloat(style.marginTop, 10) +
          window.parseFloat(style.marginBottom, 10) +
          childClientRect.height;
        estimatedHeights.set(child, height);
      }
      return estimatedHeights.get(child);
    };

    const previouslyVisible = new Set();
    for (let child = this.firstChild; child !== null; child = child.nextSibling) {
      if (!child.hasAttribute('invisible')) {
        previouslyVisible.add(child);
      }
    }

    let beforePreviouslyVisible = previouslyVisible.size > 0;
    let nextTop = 0;
    let renderedHeight = 0;

    // The estimated height of all elements made invisible since the last time
    // an element was made visible (or start of the child list).
    let currentInvisibleRunHeight = 0;
    // The next empty space sentinel that should be reused, if any.
    let nextEmptySpaceSentinel = this[_emptySpaceSentinelContainer].firstChild;
    // Inserts an empty space sentinel representing the last contiguous run of
    // invisible elements. Reuses already existing empty space sentinels, if
    // possible.
    const insertEmptySpaceSentinelIfNeeded = () => {
      if (currentInvisibleRunHeight > 0) {
        let sentinel = nextEmptySpaceSentinel;
        if (nextEmptySpaceSentinel === null) {
          sentinel = document.createElement('div');
          this[_emptySpaceSentinelContainer].appendChild(sentinel);
        }
        nextEmptySpaceSentinel = sentinel.nextSibling;

        const sentinelStyle = sentinel.style;
        sentinelStyle.top = `${nextTop - currentInvisibleRunHeight}px`;
        sentinelStyle.height = `${currentInvisibleRunHeight}px`,

        this[_intersectionObserver].observe(sentinel);

        currentInvisibleRunHeight = 0;
      }
    };

    for (let child = this.firstChild; child !== null; child = child.nextSibling) {
      if (beforePreviouslyVisible && previouslyVisible.has(child)) {
        beforePreviouslyVisible = false;
      }

      let estimatedHeight = getAndUpdateHeightEstimate(child);

      const childClientTop = thisClientRect.top + nextTop;
      const maybeInViewport =
        (0 <= childClientTop + estimatedHeight) &&
        (childClientTop <= window.innerHeight);
      if (maybeInViewport || child === childToForceVisible) {
        if (child.hasAttribute('invisible')) {
          child.removeAttribute('invisible');
          this[_resizeObserver].observe(child);
          this[_intersectionObserver].observe(child);

          const lastEstimatedHeight = estimatedHeight;
          estimatedHeight = getAndUpdateHeightEstimate(child);

          if (beforePreviouslyVisible) {
            const scrollingAncestor = nearestScrollingAncestor(this);
            if (scrollingAncestor !== null) {
              scrollingAncestor.scrollBy(0, estimatedHeight - lastEstimatedHeight);
            }
          }
        }

        const isInViewport =
          (0 <= childClientTop + estimatedHeight) &&
          (childClientTop <= window.innerHeight);

        if (isInViewport || child === childToForceVisible) {
          insertEmptySpaceSentinelIfNeeded();

          child.style.top = `${nextTop - renderedHeight}px`;
          renderedHeight += estimatedHeight;
        } else {
          child.setAttribute('invisible', '');
          this[_resizeObserver].unobserve(child);
          this[_intersectionObserver].unobserve(child);

          currentInvisibleRunHeight += estimatedHeight;
        }
      } else {
        if (!child.hasAttribute('invisible')) {
          child.setAttribute('invisible', '');
          this[_resizeObserver].unobserve(child);
          this[_intersectionObserver].unobserve(child);
        }

        currentInvisibleRunHeight += estimatedHeight;
      }

      nextTop += estimatedHeight;
    }

    insertEmptySpaceSentinelIfNeeded();

    // Remove any extra empty space sentinels.
    while (nextEmptySpaceSentinel !== null) {
      const sentinel = nextEmptySpaceSentinel;
      nextEmptySpaceSentinel = sentinel.nextSibling;

      this[_intersectionObserver].unobserve(sentinel);
      sentinel.remove();
    }

    this.style.height = `${nextTop}px`;
  }
}
