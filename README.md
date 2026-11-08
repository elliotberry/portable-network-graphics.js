portable-network-graphics.js
======
![](./swagg.jpg)
A PNG decoder in JS. Node only.
 
## Usage
Install the module

    yarn add elliotberry/portable-network-graphics.js
    
import the module and decode a PNG

    import PNG from 'portable-network-graphics.js';

    // RGBA pixels as a Uint8Array
    const pixels = await PNG.decode('some.png');

You can also call `PNG.load(path)` to load the PNG (but not decode the pixels) synchronously. If you already
have the PNG data in a buffer, simply use `new PNG(buffer)`. Then call:

- `await png.decode()` for RGBA pixels
- `await png.decodePixels()` / `png.decodePixelsSync()` for the raw pixel bytes
- `png.copyToImageData(buffer, pixels)` to copy decoded pixels into your own RGBA buffer

Malformed files throw (constructor) or reject (async decode); they never throw uncaught.

Run the tests with `npm test`.
