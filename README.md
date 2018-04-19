# Add to Homescreen call out
Module that allows you to add a call out to 'Add to Home Screen' on iOS devices.
This has been modified so it's usuable as a es6 module instead of a global lib

## Installation
`npm install add-to-homescreen-esm` or `yarn add add-to-homescreen-esm`


## Example
```js
import AddToHomescreen from 'add-to-homescreen-esm'

// create AddToHomescreen
let ath = new AddToHomescreen()

if(condition) {
    // show the call out on the page
    ath.show()
}

// or, you can autostart it, this will autoshow once this module is loaded
new AddToHomescreen({ autostart: true })

// you can pass many options to the constructor, check the docs
let athWithOpts = new AddToHomescreen({
    skipFirstVisit: true,
    icon: false,
    message: 'Add us to your homescreen!'
})

condition && athWithOpts.show()

```


For more, consult the original project's [website](http://cubiq.org/add-to-home-screen).
