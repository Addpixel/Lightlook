const Lightlook = (() => {
  
  'use strict'
  
  // Distance a touch must travel before its direction is determined.
  const TOUCH_MOVE_THRESHOLD = 5 // px
  // Distance the image must be swiped for the swipe-close action to trigger.
  const SWIPE_CLOSE_THRESHOLD = 56 // px
  // Distance the image must be swiped before the opacity of the box is reduced.
  const SWIPE_CLOSE_OPACITY_THRESHOLD = 32 // px
  // Distance the image must be swiped for the opacity of the box to be 0.
  const SWIPE_CLOSE_OPACITY_DISTANCE = 196 // px
  // Factor for horizontal swipes, 1 for no drag, 0 for no horizontal movement.
  const SWIPE_CLOSE_HORIZONTAL_DRAG = 0.35 // %
  // Minimum scale of the image.
  const SWIPE_CLOSE_MIN_SCALE = 0.7 // %
  const SWIPE_NAVIGATE_THRESHOLD = 32 // px
  // Time to wait for the DOM to update (e.g. after setting attributes).
  const DOM_UPDATE_DELAY = 50 // ms
  // Duration of the CSS show Lightlook transition.
  const SHOW_ANIMATION_DURATION = 250 // ms
  // Duration of the CSS hide Lightlook transition.
  const HIDE_ANIMATION_DURATION = 250 // ms
  // A transparent pixel as base64 encoded GIF image file.
  const TRANSPARENT_GIF_BASE64 = 'data:image/gif;base64,'+
                                 'R0lGODlhAQABAAAAACH5BAEKAAEAL'+
                                 'AAAAAABAAEAAAICTAEAOw=='
  // Vendor prefix for the CSS `transform` property or an empty string.
  const TRANSFORM_PREFIX = document.body.style.transform === undefined ? '-webkit-' : ''
  // DOM nodes of Lightlook.
  const DOM = {
    wrapper: document.createElement('div'),
    box: document.createElement('div'),
    closeButton: document.createElement('button'),
    image: document.createElement('img')
  }
  // Whether the browser supports `srcset` attributes.
  const BROWSER_SUPPORTS_SRCSET = DOM.image.srcset !== undefined
  
  // Utility Functions
  
  // Clamps a value between a minimum and a maximum value.
  const clamp = (x, min, max) => Math.min(Math.max(x, min), max)
  // Modulo operation, the result has the same sign as the divisor.
  const mod = (x, y) => x - y * math.floor(x / y)
  // Maps a value from one scale to another.
  const map = (x, from0, to0, from1, to1) => (((x - from0) * (to1 - from1)) / (to0 - from0)) + from1
  // Maps and clamps a value to a new scale.
  const cmap = (x, from0, to0, from1, to1) => clamp(map(x, from0, to0, from1, to1), Math.min(from1, to1), Math.max(from1, to1))
  // Calls a callback after the DOM has updated.
  const requestDOMUpdate = (callback) => {
    setTimeout(callback, DOM_UPDATE_DELAY)
  }
  // Registers an event listener and removes it after the first call.
  const once = (target, type, listener, options) => {
    const once = function (event) {
      target.removeEventListener(type, once, options)
      return listener.apply(this, [event])
    }
    
    target.addEventListener(type, once, options)
  }
  
  // State
  
  // Whether a Lightlook is open.
  let isOpen = false
  // Currently active Lightlook. Is set on open.
  let activeLightlook = null
  // Timeout ID of the show Lightlook timeout.
  let showTimeout = null
  // Timeout ID of the hide Lightlook timeout.
  let hideTimeout = null
  // Current touch session, `null` if no touch session is active.
  let touchsession = null
  // Whether a key is currently long pressed when opening/closing Lightlook.
  let isLongKeyPress = false
  let isScrollClosing = false
  let initScrollPoint = { x: 0, y: 0 }
  
  // Named Conditions
  
  const isHistoryStateWithLightlookIndex = (state) =>
    typeof state === 'object'
    && state !== null
    && typeof state.lightlookIndex === 'number'
  
  //
  // Blocking History
  //
  
  const blockingHistory = {
    isBlocking: false,
    perform(func) {
      blockingHistory.isBlocking = true
      func()
      setTimeout(() => { blockingHistory.isBlocking = false }, 0)
    },
    back() {
      blockingHistory.perform(() => { history.back() })
    }
  }
  
  window.addEventListener('popstate', (event) => {
    if (blockingHistory.isBlocking) { return }
    if (activeLightlook === null) { return }
    
    if (event.state === null) {
      activeLightlook.performClose({ setFocus: false })
    }
    else if (isHistoryStateWithLightlookIndex(event.state)) {
      activeLightlook.showItemAtIndex(event.state.lightlookIndex)
    }
  })
  
  //
  // Classes
  //
  
  class LightlookTransform {
    static transition({ element, fromTransform = null, toTransform, duration }) {
      if (fromTransform !== null) {
        fromTransform.applyTo(element)
      }
      
      requestDOMUpdate(() => {
        element.classList.add('uses-transitions')
        toTransform.applyTo(element)
        
        setTimeout(() => element.classList.remove('uses-transitions'), duration)
      })
    }
    
    static coveringTransform({ targetRect, coverRect, transformOriginX, transformOriginY }) {
      const scale = targetRect.width / coverRect.width
      
      return new LightlookTransform({
        x: targetRect.left + coverRect.width * -transformOriginX + targetRect.width * transformOriginX,
        y: targetRect.top + coverRect.height * -transformOriginY + targetRect.height * transformOriginY,
        scale: scale
      })
    }
    
    constructor({ x = 0, y = 0, scale = 1, rotation = 0 } = {}) {
      this.x = x
      this.y = y
      this.scale = scale
      this.rotation = rotation
    }
    
    applyTo(element) {
      element.style[TRANSFORM_PREFIX + 'transform'] =
        `translate(${this.x}px, ${this.y}px)
         scale(${this.scale})
         rotate(${this.rotation}deg)`
    }
  }
  
  class LightlookImage {
    constructor(src, srcset, alt, width, height) {
      this.src = src
      this.srcset = srcset
      this.alt = alt
      this.width = width
      this.height = height
    }
    
    get fittingTransform() {
      // Applying padding; `activeLightlook.padding` if both of the two
      // `paddingMin` rules apply, else 0.
      const ap = (innerWidth  >= activeLightlook.paddingMinWidth &&
                  innerHeight >= activeLightlook.paddingMinHeight) ?
                  activeLightlook.padding : 0
      
      // Available width and height that the image is fitted into.
      const aw = innerWidth  - 2 * ap
      const ah = innerHeight - 2 * ap
      
      // Width and height of the full resolution image.
      const iw = this.width
      const ih = this.height
      
      // Minimal ratio of the available space and the `image` size.
      const rw = Math.min(aw, iw) / iw
      const rh = Math.min(ah, ih) / ih
      
      // Minimal minimal ratio.
      const scale = Math.min(rw, rh)
      
      // Define position according to fitting size in container.
      const x = Math.round((innerWidth  - iw) / 2)
      const y = Math.round((innerHeight - ih) / 2)
      
      return new LightlookTransform({ x, y, scale })
    }
  }
  
  const LightlookItem = function(lightlook, node, image, preview, button, isLinked) {
    // Constructor
    this.lightlook = lightlook
    this.node = node
    this.image = image
    this.preview = preview
    this.button = button
    this.isLinked = isLinked
    
    this.handleClick = (event) => {
      event.preventDefault()
      
      if (isLongKeyPress) { return } // early exit
      
      this.lightlook.showItem(this, { setFocus: true })
    }
    
    this.handleKeydown = (event) => {
      const key = event.which || event.keyCode
      
      switch (key) {
      case 13: // [enter]
      case 32: // [space]
        event.preventDefault()
        if (isLongKeyPress) { return } // early exit
        isLongKeyPress = true
        
        this.lightlook.showItem(this, { setFocus: true })
        
        once(window, 'keyup', () => { isLongKeyPress = false })
        break
      }
    }
    
    this.handleKeyup = (event) => {
      const key = event.which || event.keyCode
      
      switch (key) {
      case 13: // [enter]
      case 32: // [space]
        event.preventDefault()
        break
      }
    }
    
    this.enableEventListeners = () => {
      this.button.addEventListener('click', this.handleClick)
      this.button.addEventListener('keydown', this.handleKeydown)
      this.button.addEventListener('keyup', this.handleKeyup)
    }
    
    this.disableEventListeners = () => {
      this.button.removeEventListener('click', this.handleClick)
      this.button.removeEventListener('keydown', this.handleKeydown)
      this.button.removeEventListener('keyup', this.handleKeyup)
    }
    
    this.enableEventListeners()
  }
  
  const Lightlook = function(elements, { padding = 20, paddingMinWidth = 720, paddingMinHeight = 520, navigable = true, circles = false } = {}) {
    // Constructor
    this.padding = padding
    this.paddingMinWidth = paddingMinWidth
    this.paddingMinHeight = paddingMinHeight
    this.navigable = navigable
    this.circles = circles
    this.currentItem = null
    this.items = Array.from(elements, (node) => {
      // Whether the preview image is linked to a higher resolution version.
      const isLinked = node.parentNode.tagName === 'A'
      // Address of the currently loaded preview image source.
      const src = (x => x.currentSrc !== undefined ? x.currentSrc : x.getAttribute('src'))(node)
      // Source-set of the preview image or its source with an `1x` mark.
      const srcset = (x => typeof x === 'string' && x !== '' ? x : `${src} 1x`)(node.srcset)
      // Width of the preview image.
      const width = parseInt(node.width, 10)
      // Height of the preview image.
      const height = parseInt(node.height, 10)
      // Preview image.
      const preview = new LightlookImage(src, srcset, node.alt, width, height)
      // Maximum resolution image. Same as preview image if `!isLinked`.
      const image = ((parentNode) => {
        if (isLinked) {
          // Address of the linked image source.
          const src = parentNode.href
          // Source-set of linked image or its source with an `1x` mark.
          const srcset = (x => typeof x === 'string' && x !== '' ? x : `${src} 1x`)(parentNode.getAttribute('data-srcset'))
          // Width of the linked image.
          const width = parseInt(parentNode.getAttribute('data-width'), 10)
          // Height of the linked image.
          const height = parseInt(parentNode.getAttribute('data-height'), 10)
          
          return new LightlookImage(src, srcset, node.alt, width, height)
        } else {
          return preview
        }
      })(node.parentNode)
      // Button element for opening Lightlook. Parent anchor node if linked,
      // else image node.
      const button = isLinked ? node.parentNode : node
      
      return new LightlookItem(this, node, image, preview, button, isLinked)
    })
    
    const handleKeydown = (event) => {
      const key = event.which || event.keyCode
      
      switch (key) {
      case 13: // [enter]
      case 27: // [esc]
      case 32: // [space]
        event.preventDefault()
        if (isLongKeyPress) { return } // early exit
        isLongKeyPress = true
        
        this.performClose({ setFocus: true })
        
        once(window, 'keyup', () => { isLongKeyPress = false })
        break
      }
    }
    
    const handleKeyup = (event) => {
      const key = event.which || event.keyCode
      
      switch (key) {
      case 37: // [left]
        event.preventDefault()
        this.showPreviousItem({ setFocus: true })
        break
      case 39: // [right]
        event.preventDefault()
        this.showNextItem({ setFocus: true })
        break
      }
    }
    
    const handleScroll = () => {
      if (!isScrollClosing) {
        this.performClose({ setFocus: false })
        isScrollClosing = true
      }
      
      DOM.image.style.top = `${initScrollPoint.y - Math.max(scrollY, 0)}px`
      DOM.image.style.left = `${initScrollPoint.x - Math.max(scrollX, 0)}px`
    }
    
    const handleResize = () => {
      if (this.currentItem === null) { return } // early exit
      
      this.currentItem.image.fittingTransform.applyTo(DOM.image)
    }
    
    // Shows a Lightlook item. Opens Lightlook if not already open.
    //
    // - parameter newItem: LightlookItem: Item to be displayed.
    // - parameter Object = {}: {
    //     setFocus: boolean = true: Whether to focus the Lightlook element. }
    // - mutates: activeLightlook, this.currentItem, showTimeout,
    //            initScrollPoint, isScrollClosing, isOpen
    this.showItem = (newItem, { setFocus = true } = {}) => {
      if (newItem === this.currentItem) { return } // early exit
      
      // Set state
      activeLightlook = this
      const newIndex = this.items.indexOf(newItem)
      
      // Remove event listeners from the new item
      newItem.disableEventListeners()
      
      if (this.currentItem !== null) {
        // Add the event listerners back to the current (soon previous) item
        this.currentItem.enableEventListeners()
        // Show current (soon previous) item
        this.currentItem.node.style.visibility = 'visible'
      }
      
      // Cancel close-Lightlook Timeout
      clearTimeout(hideTimeout)
      
      // Open Lightlook
      const fromTransform = LightlookTransform.coveringTransform({
        targetRect: newItem.node.getBoundingClientRect(),
        coverRect: newItem.image,
        transformOriginX: 0.5,
        transformOriginY: 0.5 })
      const toTransform = newItem.image.fittingTransform
      
      if (isOpen) {
        toTransform.applyTo(DOM.image)
        newItem.node.style.visibility = 'hidden'
      } else {
        // Apply `from`-transform and unhide Lightlook
        fromTransform.applyTo(DOM.image)
        DOM.wrapper.removeAttribute('hidden')
        
        requestDOMUpdate(() => {
          // Fade Lightlook in
          DOM.wrapper.classList.add('open')
          newItem.node.style.visibility = 'hidden'
          
          // Apply `to`-transform and show Lightlook
          LightlookTransform.transition({
            element: DOM.image,
            fromTransform: fromTransform,
            toTransform: toTransform,
            duration: SHOW_ANIMATION_DURATION })
          
          showTimeout = setTimeout(() => {
            // Mark scroll position
            initScrollPoint = { x: scrollX, y: scrollY }
            
            // Install event listener
            DOM.box.addEventListener('click', this.close)
            DOM.closeButton.addEventListener('click', this.close)
            DOM.closeButton.addEventListener('touchend', this.close)
            DOM.image.addEventListener('click', this.close)
            
            window.addEventListener('keydown', handleKeydown)
            window.addEventListener('keyup', handleKeyup)
            window.addEventListener('resize', handleResize)
            
            // Add extra time buffer before scroll handler is installed. This
            // gives the agent time to finish scrolling while opening Lightlook 
            // and not immediately close Lightlook. The scroll listener is
            // removed after `HIDE_ANIMATION_DURATION`ms, fireing this timeout
            // after that duration would not remove the event listener.
            setTimeout(() => {
              window.addEventListener('scroll', handleScroll)
            }, HIDE_ANIMATION_DURATION)
          }, SHOW_ANIMATION_DURATION)
        })
      }
      
      // Modify history
      if (isHistoryStateWithLightlookIndex(history.state)) {
        history.replaceState({ lightlookIndex: newIndex }, null)
      } else {
        history.pushState({ lightlookIndex: newIndex }, null)
      }
      
      // Set size
      DOM.image.style.width = newItem.image.width + 'px'
      DOM.image.style.height = newItem.image.height + 'px'
      DOM.image.width = newItem.image.width
      DOM.image.height = newItem.image.height
      // Set alternative text
      DOM.image.alt = newItem.image.alt
      // Set image source
      DOM.image.style.backgroundImage = `url(${newItem.preview.src})`
      // Remove scrolling offset
      DOM.image.style.left = '0px'
      DOM.image.style.top = '0px'
      // Clear previous image sources
      DOM.image.src = newItem.preview.src
      DOM.image.srcset = ''
      
      // Set new image sources
      if (BROWSER_SUPPORTS_SRCSET) {
        DOM.image.srcset = newItem.image.srcset
      } else {
        DOM.image.src = newItem.image.src
      }
      
      // Set Focus
      if (setFocus) {
        DOM.wrapper.focus()
      }
      
      // Set state
      this.currentItem = newItem
      isScrollClosing = false
      isOpen = true
    }
    
    // Closes Lightlook. Does not return to a previous history record.
    //
    // - parameter Object = {}: {
    //     setFocus: boolean = true: Whether to focus the button element. }
    // - mutates: hideTimeout, this.currentItem, isOpen
    this.performClose = ({ setFocus = true } = {}) => {
      if (!isOpen) { return }
      
      // Cancel close-Lightlook Timeout
      clearTimeout(showTimeout)
      
      // Remove event listeners
      DOM.box.removeEventListener('click', this.close)
      DOM.closeButton.removeEventListener('click', this.close)
      DOM.closeButton.removeEventListener('touchend', this.close)
      DOM.image.removeEventListener('click', this.close)
      
      window.removeEventListener('keydown', handleKeydown)
      window.removeEventListener('keyup', handleKeyup)
      window.removeEventListener('resize', handleResize)
      
      // Fade Lightlook out
      DOM.wrapper.classList.remove('open')
      
      // Transition Lightlook image over preview image
      const closeTransform = LightlookTransform.coveringTransform({
        targetRect: this.currentItem.node.getBoundingClientRect(),
        coverRect: this.currentItem.image,
        transformOriginX: 0.5,
        transformOriginY: 0.5 })
      
      LightlookTransform.transition({
        element: DOM.image,
        toTransform: closeTransform,
        duration: HIDE_ANIMATION_DURATION })
      
      // Hide Lightlook
      hideTimeout = setTimeout(() => {
        if (this.currentItem === null) { return }
        
        window.removeEventListener('scroll', handleScroll)
        this.currentItem.enableEventListeners()
        
        DOM.image.src = TRANSPARENT_GIF_BASE64
        DOM.image.srcset = ''
        // Remove scrolling offset
        DOM.image.style.left = '0px'
        DOM.image.style.top = '0px'
        
        this.currentItem.node.style.visibility = 'visible'
        DOM.wrapper.setAttribute('hidden', 'hidden')
        
        if (setFocus) {
          this.currentItem.button.focus()
        }
        
        this.currentItem = null
      }, HIDE_ANIMATION_DURATION)
      
      // Set state
      isOpen = false
    }
    
    // Closes Lightlook and manages history navigation.
    //
    // - parameter Object = {}: {
    //     setFocus: boolean = true: Whether to focus the button element. }
    this.close = ({ setFocus = false } = {}) => {
      this.performClose({ setFocus })
      blockingHistory.back()
    }
    
    this.showItemAtIndex = (index) => {
      if (!this.navigable) { return }
      
      if (this.circles) {
        index = mod(index, this.items.length)
      } else {
        index = clamp(index, 0, this.items.length - 1)
      }
      
      this.showItem(this.items[index])
    }
    
    this.showNextItem = () => {
      const currentIndex = this.items.indexOf(this.currentItem)
      this.showItemAtIndex(currentIndex + 1)
    }
    
    this.showPreviousItem = () => {
      const currentIndex = this.items.indexOf(this.currentItem)
      this.showItemAtIndex(currentIndex - 1)
    }
  }
  
  //
  // Touch
  //
  
  class TouchSession {
    constructor({ type = null, initTouch } = {}) {
      this.type = type
      this.initTouch = initTouch
      this.dx = 0
      this.dy = 0
      this.scale = 1
      this.rotation = 0
    }
  }
  TouchSession.SWIPE_CLOSE = 'TouchSession.SWIPE_CLOSE'
  TouchSession.SWIPE_NAVIGATE = 'TouchSession.SWIPE_NAVIGATE'
  
  DOM.wrapper.addEventListener('touchstart', (event) => {
    if (touchsession !== null) { return } // early exit
    
    if (event.changedTouches.length === 1) {
      const touch = event.changedTouches.item(0)
      
      touchsession = new TouchSession({
        initTouch: touch
      })
      console.log(touchsession)
    }
  })
  DOM.wrapper.addEventListener('touchmove', (event) => {
    if (touchsession === null) { return } // early exit
    
    event.preventDefault()
    
    const touch = Array.from(event.changedTouches)
      .find(x => x.identifier === touchsession.initTouch.identifier)
    
    if (touch === undefined) { return } // early exit
    
    const dx = touch.clientX - touchsession.initTouch.clientX
    const dy = touch.clientY - touchsession.initTouch.clientY
    const dxAbs = Math.abs(dx)
    const dyAbs = Math.abs(dy)
    
    touchsession.dx = dx
    touchsession.dy = dy
    
    if (touchsession.type === null) {
      if (event.changedTouches.length === 1) {
        touchsession.type = TouchSession.SWIPE_CLOSE
        DOM.closeButton.style.opacity = 0
        DOM.box.classList.remove('uses-transition')
      }
    } else {
      if (touchsession.type === TouchSession.SWIPE_CLOSE) {
        const transform = activeLightlook.currentItem.image.fittingTransform
        
        transform.x += dx * SWIPE_CLOSE_HORIZONTAL_DRAG
        transform.y += dy
        transform.scale *= cmap(dyAbs, 0, innerHeight / 2, 1, SWIPE_CLOSE_MIN_SCALE)
        transform.applyTo(DOM.image)
        
        if (dyAbs > SWIPE_CLOSE_OPACITY_THRESHOLD) {
          DOM.box.style.opacity = cmap(dyAbs - SWIPE_CLOSE_OPACITY_THRESHOLD, 0, SWIPE_CLOSE_OPACITY_DISTANCE, 1, 0)
        } else {
          DOM.box.style.opacity = 1
        }
      }
      else if (touchsession.type === TouchSession.SWIPE_NAVIGATE) {
        const transform = activeLightlook.currentItem.image.fittingTransform
        
        transform.x += dx
        transform.applyTo(DOM.image)
      }
    }
  })
  DOM.wrapper.addEventListener('touchend', (event) => {
    if (touchsession === null) { return } // early exit
    
    if (touchsession.type === TouchSession.SWIPE_CLOSE) {
      event.preventDefault()
      
      DOM.closeButton.style.removeProperty('opacity')
      DOM.box.style.removeProperty('opacity')
      DOM.box.classList.add('uses-transition')
      
      if (Math.abs(touchsession.dy) > SWIPE_CLOSE_THRESHOLD) {
        activeLightlook.close()
      } else {
        LightlookTransform.transition({
          element: DOM.image,
          toTransform: activeLightlook.currentItem.image.fittingTransform,
          duration: SHOW_ANIMATION_DURATION })
      }
    }
    else if (touchsession.type === TouchSession.SWIPE_NAVIGATE) {
      event.preventDefault()
      
      if (Math.abs(touchsession.dx) > SWIPE_NAVIGATE_THRESHOLD) {
        if (touchsession.dx > 0) {
          activeLightlook.showPreviousItem()
        } else {
          activeLightlook.showNextItem()
        }
      }
    }
    
    touchsession = null
  })
  
  //
  // Init
  //
  
  // Wrapper
  DOM.wrapper.className = 'lightlook'
  DOM.wrapper.tabIndex = 0
  DOM.wrapper.setAttribute('role', 'dialog')
  DOM.wrapper.setAttribute('hidden', 'hidden')
  
  // Box
  DOM.box.className = 'box uses-transition'
  
  // Close Button
  DOM.closeButton.className = 'button action-close'
  DOM.closeButton.type = 'button'
  DOM.closeButton.textContent = 'Close overview'
  
  // Image
  DOM.image.className = 'image'
  DOM.image.src = TRANSPARENT_GIF_BASE64
  DOM.image.alt = ''
  
  // Build DOM
  DOM.wrapper.appendChild(DOM.box)
  DOM.wrapper.appendChild(DOM.closeButton)
  DOM.wrapper.appendChild(DOM.image)
  document.body.appendChild(DOM.wrapper)
  
  return Lightlook
  
})()
