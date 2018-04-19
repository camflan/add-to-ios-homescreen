import intlStrings from './i18n'
import '../style/addtohomescreen.css'

// Check for addEventListener browser support (prevent errors in IE<9)
let _eventListener = 'addEventListener' in window

// Check if document is loaded, needed by autostart
let _DOMReady = false
if (document.readyState === 'complete') {
    _DOMReady = true
} else if (_eventListener) {
    window.addEventListener('load', loaded, false)
}

function loaded() {
    window.removeEventListener('load', loaded, false)
    _DOMReady = true
}

// regex used to detect if app has been added to the homescreen
let _reSmartURL = /\/ath(\/)?$/
let _reQueryString = /([?&]ath=[^&]*$|&ath=[^&]*(&))/

// browser info and capability
let _ua = window.navigator.userAgent
let _nav = window.navigator

class AddToHomescreen {
    static defaultOptions = {
        appID: 'com.camronflanders.addtohomescreen', // local storage name (no need to change)
        fontSize: 15, // base font size, used to properly resize the popup based on viewport scale factor
        debug: false, // override browser checks
        logging: false, // log reasons for showing or not showing to js console; defaults to true when debug is true
        modal: false, // prevent further actions until the message is closed
        showClose: true, // show the close button on the popup
        mandatory: false, // you can't proceed if you don't add the app to the homescreen
        autostart: false, // show the message automatically
        skipFirstVisit: false, // show only to returning visitors (ie: skip the first time you visit)
        startDelay: 1, // display the message after that many seconds from page load
        lifespan: 15, // life of the message in seconds
        displayPace: 1440, // minutes before the message is shown again (0: display every time, default 24 hours)
        maxDisplayCount: 0, // absolute maximum number of times the message will be shown to the user (0: no limit)
        icon: true, // add touch icon to the message
        message: '', // the message can be customized
        validLocation: [], // list of pages where the message will be shown (array of regexes)
        onInit: null, // executed on instance creation
        onShow: null, // executed when the message is shown
        onRemove: null, // executed when the message is removed
        onAdd: null, // when the application is launched the first time from the homescreen (guesstimate)
        onPrivate: null, // executed if user is in private mode
        privateModeOverride: false, // show the message even in private mode (very rude)
        detectHomescreen: false, // try to detect if the site has been added to the homescreen (false | true | 'hash' | 'queryString' | 'smartURL')
    }

    static defaultSession = {
        lastDisplayTime: 0, // last time we displayed the message
        returningVisitor: false, // is this the first time you visit
        displayCount: 0, // number of times the message has been shown
        optedout: false, // has the user opted out
        added: false, // has been actually added to the homescreen
    }

    static events = {
        load: '_delayedShow',
        error: '_delayedShow',
        orientationchange: 'resize',
        resize: 'resize',
        scroll: 'resize',
        click: 'remove',
        touchmove: '_preventDefault',
        transitionend: '_removeElements',
        webkitTransitionEnd: '_removeElements',
        MSTransitionEnd: '_removeElements',
    }

    container = document.body

    hasLocalStorage = false
    ready = false
    shown = false

    language = (_nav.language &&
        _nav.language.toLowerCase().replace('-', '_')) ||
    ''

    isRetina = false
    isIDevice = false
    isMobileChrome = false
    isMobileIE = false
    isMobileSafari = false
    isTablet = false
    OS = ''
    OSVersion = 0
    isStandalone = false
    isCompatible = false

    constructor(options) {
        if (!_eventListener) {
            console.error("ATH doesn't work on IE < 9")
            return false
        }

        this.sniffEnvironment()

        this.options = { ...AddToHomescreen.defaultOptions, ...options }

        if (
            this.options &&
            this.options.debug &&
            this.options.logging != false
        ) {
            this.options.logging = true
        }

        this.options = {
            ...this.options,
            mandatory:
                this.options.mandatory &&
                ('standalone' in window.navigator || this.options.debug),
            modal: this.options.modal || this.options.mandatory,
            detectHomescreen:
                this.options.detectHomescreen === true
                    ? 'hash'
                    : this.options.detectHomescreen,
        }

        if (this.options.mandatory) {
            this.options.startDelay = -0.5
        }

        if (this.options.debug) {
            this.isCompatible = true
            this.OS =
                typeof this.options.debug == 'string'
                    ? this.options.debug
                    : this.OS == 'unsupported'
                        ? 'android'
                        : this.OS
            this.OSVersion = this.OS == 'ios' ? '8' : '4'
        }

        this.hasToken =
            document.location.hash == '#ath' ||
            _reSmartURL.test(document.location.href) ||
            _reQueryString.test(document.location.search)

        // load session
        this.session = this.getItem(this.options.appID)
        this.session = this.session ? JSON.parse(this.session) : {}

        // user most likely came from a direct link containing our token, we don't need it and we remove it
        if (this.hasToken && (!this.isCompatible || !this.session)) {
            this.hasToken = false
            this._removeToken()
        }

        // the device is not supported
        if (!this.isCompatible) {
            this.doLog(
                'Add to homescreen: not displaying callout because device not supported'
            )
            return
        }

        this.session = {
            ...AddToHomescreen.defaultSession,
            ...this.session,
        }

        this.testLocalStorage()

        let e = this.shouldPreventDisplay()
        if (e) {
            throw 'Preventing display.'
        }

        this.ready = true

        if (this.options.onInit) {
            this.options.onInit.call(this)
        }

        if (this.options.autostart) {
            this.doLog('Add to homescreen: autostart displaying callout')
            this.show()
        }
    }

    shouldPreventDisplay = () => {
        let isValidLocation = !this.options.validLocation.length

        for (var i = this.options.validLocation.length; i--; ) {
            if (this.options.validLocation[i].test(document.location.href)) {
                isValidLocation = true
                break
            }
        }

        // check compatibility with old versions of add to homescreen. Opt-out if an old session is found
        if (this.getItem('addToHome')) {
            this.optOut()
        }

        // critical errors:
        if (this.session.optedout) {
            this.doLog(
                'Add to homescreen: not displaying callout because user opted out'
            )
            return true
        }
        if (this.session.added) {
            this.doLog(
                'Add to homescreen: not displaying callout because already added to the homescreen'
            )
            return true
        }

        if (!isValidLocation) {
            this.doLog(
                'Add to homescreen: not displaying callout because not a valid location'
            )
            return true
        }

        // check if the app is in stand alone mode
        if (this.isStandalone) {
            // execute the onAdd event if we haven't already
            if (!this.session.added) {
                this.session.added = true
                this.updateSession()

                if (this.options.onAdd && this.hasLocalStorage) {
                    // double check on localstorage to avoid multiple calls to the custom event
                    this.options.onAdd.call(this)
                }
            }

            this.doLog(
                'Add to homescreen: not displaying callout because in standalone mode'
            )
            return true
        }

        // (try to) check if the page has been added to the homescreen
        if (this.options.detectHomescreen) {
            // the URL has the token, we are likely coming from the homescreen
            if (this.hasToken) {
                _removeToken() // we don't actually need the token anymore, we remove it to prevent redistribution

                // this is called the first time the user opens the app from the homescreen
                if (!this.session.added) {
                    this.session.added = true
                    this.updateSession()

                    if (this.options.onAdd && this.hasLocalStorage) {
                        // double check on localstorage to avoid multiple calls to the custom event
                        this.options.onAdd.call(this)
                    }
                }

                this.doLog(
                    'Add to homescreen: not displaying callout because URL has token, so we are likely coming from homescreen'
                )
                return true
            }

            // URL doesn't have the token, so add it
            if (this.options.detectHomescreen == 'hash') {
                history.replaceState(
                    '',
                    window.document.title,
                    document.location.href + '#ath'
                )
            } else if (this.options.detectHomescreen == 'smartURL') {
                history.replaceState(
                    '',
                    window.document.title,
                    document.location.href.replace(/(\/)?$/, '/ath$1')
                )
            } else {
                history.replaceState(
                    '',
                    window.document.title,
                    document.location.href +
                        (document.location.search ? '&' : '?') +
                        'ath='
                )
            }
        }

        // check if this is a returning visitor
        if (!this.session.returningVisitor) {
            this.session.returningVisitor = true
            this.updateSession()

            // we do not show the message if this is your first visit
            if (this.options.skipFirstVisit) {
                this.doLog(
                    'Add to homescreen: not displaying callout because skipping first visit'
                )
                return true
            }
        }

        // we do no show the message in private mode
        if (!this.options.privateModeOverride && !this.hasLocalStorage) {
            this.doLog(
                'Add to homescreen: not displaying callout because browser is in private mode'
            )
            return true
        }

        return false
    }

    testLocalStorage = () => {
        // check if we can use the local storage
        try {
            if (!localStorage) {
                throw new Error('localStorage is not defined')
            }

            localStorage.setItem(
                this.options.appID,
                JSON.stringify(this.session)
            )
            this.hasLocalStorage = true
        } catch (e) {
            // we are most likely in private mode
            this.hasLocalStorage = false
            this.options.onPrivate && this.options.onPrivate.call(this)
        }
    }

    sniffEnvironment = () => {
        this.isRetina = window.devicePixelRatio && window.devicePixelRatio > 1
        this.isIDevice = /iphone|ipod|ipad/i.test(_ua)
        this.isMobileChrome =
            _ua.indexOf('Android') > -1 &&
            /Chrome\/[.0-9]*/.test(_ua) &&
            _ua.indexOf('Version') == -1
        this.isMobileIE = _ua.indexOf('Windows Phone') > -1
        this.isMobileSafari =
            this.isIDevice &&
            _ua.indexOf('Safari') > -1 &&
            _ua.indexOf('CriOS') < 0
        this.OS = this.isIDevice
            ? 'ios'
            : this.isMobileChrome
                ? 'android'
                : this.isMobileIE
                    ? 'windows'
                    : 'unsupported'

        this.OSVersion = _ua.match(/(OS|Android) (\d+[_.]\d+)/)
        this.OSVersion =
            this.OSVersion && this.OSVersion[2]
                ? +this.OSVersion[2].replace('_', '.')
                : 0

        this.isStandalone =
            'standalone' in window.navigator && window.navigator.standalone
        this.isTablet =
            (this.isMobileSafari && _ua.indexOf('iPad') > -1) ||
            (this.isMobileChrome && _ua.indexOf('Mobile') < 0)

        this.isCompatible = this.isMobileSafari && this.OSVersion >= 6
    }

    removeSession = appID => {
        try {
            if (!localStorage) {
                throw new Error('localStorage is not defined')
            }

            localStorage.removeItem(appID || this.defaults.appID)
        } catch (e) {
            // we are most likely in private mode
        }
    }

    doLog = logStr => {
        if (this.options.logging) {
            console.log(logStr)
        }
    }

    handleEvent = e => {
        let type = AddToHomescreen.events[e.type]

        if (type) {
            this[type](e)
        }
    }

    show = force => {
        // in autostart mode wait for the document to be ready
        if (this.options.autostart && !_DOMReady) {
            setTimeout(this.show.bind(this), 50)
            // we are not displaying callout because DOM not ready, but don't log that because
            // it would log too frequently
            return
        }

        // message already on screen
        if (this.shown) {
            this.doLog(
                'Add to homescreen: not displaying callout because already shown on screen'
            )
            return
        }

        var now = Date.now()
        var lastDisplayTime = this.session.lastDisplayTime

        if (force !== true) {
            // this is needed if autostart is disabled and you programmatically call the show() method
            if (!this.ready) {
                this.doLog(
                    'Add to homescreen: not displaying callout because not ready'
                )
                return
            }

            // we obey the display pace (prevent the message to popup too often)
            if (now - lastDisplayTime < this.options.displayPace * 60000) {
                this.doLog(
                    'Add to homescreen: not displaying callout because displayed recently'
                )
                return
            }

            // obey the maximum number of display count
            if (
                this.options.maxDisplayCount &&
                this.session.displayCount >= this.options.maxDisplayCount
            ) {
                this.doLog(
                    'Add to homescreen: not displaying callout because displayed too many times already'
                )
                return
            }
        }

        this.shown = true

        // increment the display count
        this.session.lastDisplayTime = now
        this.session.displayCount++
        this.updateSession()

        // try to get the highest resolution application icon
        if (!this.applicationIcon) {
            if (this.OS == 'ios') {
                this.applicationIcon = document.querySelector(
                    'head link[rel^=apple-touch-icon][sizes="152x152"],head link[rel^=apple-touch-icon][sizes="144x144"],head link[rel^=apple-touch-icon][sizes="120x120"],head link[rel^=apple-touch-icon][sizes="114x114"],head link[rel^=apple-touch-icon]'
                )
            } else {
                this.applicationIcon = document.querySelector(
                    'head link[rel^="shortcut icon"][sizes="196x196"],head link[rel^=apple-touch-icon]'
                )
            }
        }

        let message = ''

        if (
            typeof this.options.message == 'object' &&
            this.language in this.options.message
        ) {
            // use custom language message
            message = this.options.message[this.language][this.OS]
        } else if (
            typeof this.options.message == 'object' &&
            this.OS in this.options.message
        ) {
            // use custom os message
            message = this.options.message[this.OS]
        } else if (this.options.message in intlStrings) {
            // you can force the locale
            message = intlStrings[this.options.message][this.OS]
        } else if (this.options.message !== '') {
            // use a custom message
            message = this.options.message
        } else if (this.OS in intlStrings[this.language]) {
            // otherwise we use our message
            message = intlStrings[this.language][this.OS]
        }

        // add the action icon
        message =
            '<p>' +
            message.replace(/%icon(?:\[([^\]]+)\])?/gi, function(
                matches,
                group1
            ) {
                return (
                    '<span class="ath-action-icon">' +
                    (group1 ? group1 : 'icon') +
                    '</span>'
                )
            }) +
            '</p>'

        // create the message container
        this.viewport = document.createElement('div')
        this.viewport.className = 'ath-viewport'
        if (this.options.modal) {
            this.viewport.className += ' ath-modal'
        }
        if (this.options.mandatory) {
            this.viewport.className += ' ath-mandatory'
        }
        this.viewport.style.position = 'absolute'

        // create the actual message element
        this.element = document.createElement('div')
        this.element.className =
            'ath-container ath-' +
            this.OS +
            ' ath-' +
            this.OS +
            (parseInt(this.OSVersion) || '') +
            ' ath-' +
            (this.isTablet ? 'tablet' : 'phone') +
            (this.options.showClose ? ' ath-show-close' : '')
        this.element.style.cssText =
            '-webkit-transition-property:-webkit-transform,opacity;-webkit-transition-duration:0s;-webkit-transition-timing-function:ease-out;transition-property:transform,opacity;transition-duration:0s;transition-timing-function:ease-out;'
        this.element.style.webkitTransform =
            'translate3d(0,-' + window.innerHeight + 'px,0)'
        this.element.style.transform =
            'translate3d(0,-' + window.innerHeight + 'px,0)'

        // add the application icon
        if (this.options.icon && this.applicationIcon) {
            this.element.className += ' ath-icon'
            this.img = document.createElement('img')
            this.img.className = 'ath-application-icon'
            this.img.addEventListener('load', this, false)
            this.img.addEventListener('error', this, false)

            this.img.src = this.applicationIcon.href
            this.element.appendChild(this.img)
        }

        this.element.innerHTML += message

        // we are not ready to show, place the message out of sight
        this.viewport.style.left = '-99999em'

        // attach all elements to the DOM
        this.viewport.appendChild(this.element)
        this.container.appendChild(this.viewport)

        // if we don't have to wait for an image to load, show the message right away
        if (this.img) {
            this.doLog(
                'Add to homescreen: not displaying callout because waiting for img to load'
            )
        } else {
            this._delayedShow()
        }
    }

    _delayedShow = () => {
        setTimeout(this._show.bind(this), this.options.startDelay * 1000 + 500)
    }

    _show = () => {
        // update the viewport size and orientation
        this.updateViewport()

        // reposition/resize the message on orientation change
        window.addEventListener('resize', this, false)
        window.addEventListener('scroll', this, false)
        window.addEventListener('orientationchange', this, false)

        if (this.options.modal) {
            // lock any other interaction
            document.addEventListener('touchmove', this, true)
        }

        // Enable closing after 1 second
        if (!this.options.mandatory) {
            setTimeout(() => {
                this.element.addEventListener('click', this, true)
            }, 1000)
        }

        // kick the animation
        setTimeout(() => {
            this.element.style.webkitTransitionDuration = '1.2s'
            this.element.style.transitionDuration = '1.2s'
            this.element.style.webkitTransform = 'translate3d(0,0,0)'
            this.element.style.transform = 'translate3d(0,0,0)'
        }, 0)

        // set the destroy timer
        if (this.options.lifespan) {
            this.removeTimer = setTimeout(
                this.remove.bind(this),
                this.options.lifespan * 1000
            )
        }

        // fire the custom onShow event
        if (this.options.onShow) {
            this.options.onShow.call(this)
        }
    }

    remove = () => {
        clearTimeout(this.removeTimer)

        // clear up the event listeners
        if (this.img) {
            this.img.removeEventListener('load', this, false)
            this.img.removeEventListener('error', this, false)
        }

        window.removeEventListener('resize', this, false)
        window.removeEventListener('scroll', this, false)
        window.removeEventListener('orientationchange', this, false)
        document.removeEventListener('touchmove', this, true)
        this.element.removeEventListener('click', this, true)

        // remove the message element on transition end
        this.element.addEventListener('transitionend', this, false)
        this.element.addEventListener('webkitTransitionEnd', this, false)
        this.element.addEventListener('MSTransitionEnd', this, false)

        // start the fade out animation
        this.element.style.webkitTransitionDuration = '0.3s'
        this.element.style.opacity = '0'
    }

    _removeElements = () => {
        this.element.removeEventListener('transitionend', this, false)
        this.element.removeEventListener('webkitTransitionEnd', this, false)
        this.element.removeEventListener('MSTransitionEnd', this, false)

        // remove the message from the DOM
        this.container.removeChild(this.viewport)

        this.shown = false

        // fire the custom onRemove event
        if (this.options.onRemove) {
            this.options.onRemove.call(this)
        }
    }

    updateViewport = () => {
        if (!this.shown) {
            return
        }

        this.viewport.style.width = window.innerWidth + 'px'
        this.viewport.style.height = window.innerHeight + 'px'
        this.viewport.style.left = window.scrollX + 'px'
        this.viewport.style.top = window.scrollY + 'px'

        let clientWidth = document.documentElement.clientWidth

        this.orientation =
            clientWidth > document.documentElement.clientHeight
                ? 'landscape'
                : 'portrait'

        let screenWidth =
            this.OS == 'ios'
                ? this.orientation == 'portrait'
                    ? screen.width
                    : screen.height
                : screen.width
        this.scale =
            screen.width > clientWidth ? 1 : screenWidth / window.innerWidth

        this.element.style.fontSize = this.options.fontSize / this.scale + 'px'
    }

    resize = () => {
        clearTimeout(this.resizeTimer)
        this.resizeTimer = setTimeout(this.updateViewport.bind(this), 100)
    }

    updateSession = () => {
        if (this.hasLocalStorage === false) {
            return
        }

        if (localStorage) {
            localStorage.setItem(
                this.options.appID,
                JSON.stringify(this.session)
            )
        }
    }

    clearSession = () => {
        this.session = AddToHomescreen._defaultSession
        this.updateSession()
    }

    getItem = item => {
        try {
            if (!localStorage) {
                throw new Error('localStorage is not defined')
            }

            return localStorage.getItem(item)
        } catch (e) {
            // Preventing exception for some browsers when fetching localStorage key
            this.hasLocalStorage = false
        }
    }

    optOut = () => {
        this.session.optedout = true
        this.updateSession()
    }

    optIn = () => {
        this.session.optedout = false
        this.updateSession()
    }

    clearDisplayCount = () => {
        this.session.displayCount = 0
        this.updateSession()
    }

    _preventDefault = e => {
        e.preventDefault()
        e.stopPropagation()
    }
}

function _removeToken() {
    if (document.location.hash == '#ath') {
        history.replaceState(
            '',
            window.document.title,
            document.location.href.split('#')[0]
        )
    }

    if (_reSmartURL.test(document.location.href)) {
        history.replaceState(
            '',
            window.document.title,
            document.location.href.replace(_reSmartURL, '$1')
        )
    }

    if (_reQueryString.test(document.location.search)) {
        history.replaceState(
            '',
            window.document.title,
            document.location.href.replace(_reQueryString, '$2')
        )
    }
}

export default AddToHomescreen
