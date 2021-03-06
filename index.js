(function(root) {

/**
 * Cryptographically strong, hat-compatible, pseudo-random number generator
 *
 * @module cryptohat
 */

/**
 * Buffer holding random data generated by a CSPRNG.
 *
 * Invoking the CSPRNG has a large one-time cost, so we amortize that by having
 * it fill a large buffer that is used to satisfy several calls to random32().
 *
 * The buffer is a Buffer object on node.js, an Uint32Array in modern browsers,
 * and an Array of numbers in old browsers.
 *
 * @var {Buffer|Uint32Array|Array<number>}
 * @private
 */
var randomBuffer = null;

/**
 * The size of the random data buffer. Must be a multiple of 4.
 * @var {number}
 * @private
 */
var randomBufferSize = 4096;
/**
 * The first unused byte in the random data buffer.
 * @var {number}
 * @private
 */
var randomBufferOffset = randomBufferSize;

/**
 * Low-level random number generator.
 *
 * @return {number} a 32-bit random number
 * @private
 */
var random32 = null;

/**
 * Generates a random identifier.
 *
 * This implements hat's API. Take a look at {@link crypto.numberGenerator} for
 * a higher-performance API.
 *
 * @param {number} bits the desired number of bits of randomness
 * @param {number} base the base/radix used to represent the random number;
 *   must be between 2 and 36
 * @returns {string} a randomly generated identifier that meets the constraints
 *   above; the identifiers generated for a given base and number of bits are
 *   guaranteed to have the same length; in order to satisfy this constraint,
 *   the returned identifier might have leading zeros
 * @alias cryptohat
 */
var cryptohat = function(bits, base) {
  bits = bits || 128;
  if (!base && base !== 0)
    base = 16;
  return cryptohat.generator(bits, base)();
};

if (typeof(module) !== "undefined" && "exports" in module) {
  // Common.js environment.
  module.exports = cryptohat;
} else {
  // Browser.
  if (typeof(global) !== "undefined")
    root = global;

  root.cryptohat = cryptohat;
}

if (typeof(process) !== "undefined" &&
    typeof((process.versions || {}).node) === "string") {
  // Node.js implementation based on crypto.randomBytes()
  var crypto = require("crypto");
  random32 = function() {
    if (randomBufferOffset === randomBufferSize) {
      randomBufferOffset = 0;
      randomBuffer = crypto.randomBytes(randomBufferSize);
    }
    var returnValue = randomBuffer.readUInt32LE(randomBufferOffset);
    randomBufferOffset += 4;
    return returnValue;
  };

  // NOTE: This is exported for manual testing.
  cryptohat._engine = "crypto.randomBytes()";
} else if (typeof(((root || {}).crypto || {}).getRandomValues) ===
    "function") {
  // Modern browser implementation based on the W3C Crypto API
  // NOTE: Using the root object instead of window lets us find the Crypto API
  //       in Web workers.
  randomBufferSize /= 4;
  randomBuffer = new Uint32Array(randomBufferSize);
  randomBufferOffset = randomBufferSize;
  random32 = function() {
    if (randomBufferOffset === randomBufferSize) {
      randomBufferOffset = 0;
      root.crypto.getRandomValues(randomBuffer);
    }
    var returnValue = randomBuffer[randomBufferOffset];
    randomBufferOffset += 1;
    return returnValue;
  };

  // NOTE: This is exported for manual testing.
  cryptohat._engine = "window.crypto.getRandomValues()";
} else {
  // Compatibility implementation for old browsers.

  /// NOTE: we fall back to Math.random() because we have no good way of
  //        getting the high quality randomness that would be needed to seed a
  //        CSPRNG.
  random32 = function() {
    // NOTE: 4294967296 is Math.pow(2, 32). We inline the number to give V8 a
    //       better chance to implement the multiplication as << 32.
    return Math.floor(Math.random() * 4294967296);
  };

  // NOTE: This is exported for manual testing.
  cryptohat._engine = "Math.random()";
}

/**
 * Cache for the generator functions produced by this module.
 *
 * Number generators are cached using the number of bits of randomness, e.g.
 * the key for a 32-bit random number generator is "32". String generators are
 * cached based on the randomness bits and base/radix, e.g. the key for a
 * 32-bit base-10 random number generator is "32.10".
 *
 * @var {Object<String, function()>}
 * @private
 */
var generatorCache = {};

/**
 * Returns a random identifier generator.
 *
 * @param {number} bits the desired number of bits of randomness
 * @param {?number} base the base/radix used to represent the random number;
 *   must be between 2 and 36; passing in a falsey value will cause a number
 *   generator to be returned
 * @returns {function()} a generating function; if a base is provided, the
 *   function returns random identifiers as strings; otherwise, the function
 *   returns random numbers; the string identifiers returned by a generator are
 *   guaranteed to have the same length; in order to satisfy this constraint,
 *   the returned identifier might have leading zeros
 */
cryptohat.generator = function(bits, base) {
  var cacheKey = (base) ? bits.toString() + "." + base.toString() :
      bits.toString();
  var generator = generatorCache[cacheKey];
  if (!generator) {
    if (base)
      generator = newStringGenerator(bits, base);
    else
      generator = newNumberGenerator(bits);
    generatorCache[cacheKey] = generator;
  }
  return generator;
};

/**
 * Creates a random number generator.
 *
 * @param {number} bits the desired number of bits of randomness
 * @returns {function()} a generating function that returns random numbers
 * @private
 */
var newNumberGenerator = function(bits) {
  if (bits > 53) {
    throw RangeError(
        "JavaScript numbers can accurately represent at most 53 bits");
  }

  if (bits < 32) {
    // Generate a 32-bit random number and mask off the higher-order bits.
    var mask = (1 << bits) - 1;
    return function() {
      return random32() & mask;
    };
  } else if (bits > 32)  {
    // Generate two 32-bit random numbers that will become the lower and upper
    // parts of our number. Mask off the higher-order bits from the upper part,
    // and combine the two parts.
    var mask = Math.pow(2, bits - 32) - 1;

    return function() {
      // NOTE: 4294967296 is Math.pow(2, 32). We inline the number to give V8 a
      //       better chance to implement the multiplication as << 32.
      return random32() + (random32() & mask) * 4294967296;
    };
  } else {
    return random32;
  }
};

/**
 * The maximum number of digits in a number with a fixed number of bits.
 *
 * @param {number} bits the number of bits in the number
 * @param {number} base the base/radix used to represent the number; must be
 *   between 2 and 36
 * @return {number} the maximum number of digits of a number that meets the
 *   constraints above
 * @private
 */
var maxDigits = function(bits, base) {
  // NOTE: Math.log2() is not available in IE and older browsers.
  return Math.ceil((bits * Math.LN2) / Math.log(base));
};

/**
 * The characters used to represent digits.
 *
 * @var {Array<string>}
 * @private
 */
var digitStrings = "0123456789abcdefghijklmnopqrstuvwxyz".split("");

/**
 * Produces the textual representation of a number.
 *
 * @param {Array<number>} array a big-endian representation of the number; each
 *   element in the array is a 32-bit digit; the elements in the array will be
 *   trashed
 * @param {number} base the base/radix used to represent the number
 * @param {Array<string>} digits buffer used to store an intermediate
 *   representation of the number; the elements in the array will be trashed
 * @return {string} the textual representation of the number
 * @private
 */
var array32ToString = function(array, base, digits) {
  var digitCount = digits.length;
  var arrayLength = array.length;

  for (var j = digitCount - 1; j >= 0; --j) {
    var remainder = 0;
    for (var i = 0; i < arrayLength; ++i) {
      // NOTE: 4294967296 is Math.pow(2, 32). We inline the number to give V8 a
      //       better chance to implement the multiplication as << 32.
      // NOTE: the intermediate results will fit comfortably in 53 bits
      //       (actually in 38 bits) because the remainder is guaranteed be
      //       smaller than base at the beginning of the loop, and base is at
      //       most 36
      remainder = remainder * 4294967296 + array[i];
      array[i] = Math.floor(remainder / base);
      remainder = remainder % base;
    }
    digits[j] = digitStrings[remainder];
  }

  return digits.join("");
};
// NOTE: This is exported for testing.
cryptohat._array32ToString = array32ToString;

/**
 * Platform-independent implementation of String.prototype.repeat.
 *
 * @param {number} count the number of times to repeat the string
 * @return {string} a string consisting of count zero ("0") characters
 * @private
 */
var zeroRepeat = null;

if (typeof(String.prototype.repeat) === "function") {
  // Fast path for node.js >= 4 and modern browsers.
  zeroRepeat = function(count) {
    return "0".repeat(count);
  };
} else {
  // Slow path for node.js <= 0.12 and old browsers.
  zeroRepeat = function(count) {
    var result = "";
    for (var i = 0; i < count; ++i)
      result += "0";
    return result;
  };
}
// NOTE: This is exported for testing.
cryptohat._zeroRepeat = zeroRepeat;

/**
 * Pads a string with zeros until it reaches a desired length.
 *
 * @param {string} string the string to be padded
 * @param {number} the desired string length
 * @return {string} a string that has at least the desired length; the returned
 *   string will consist of some zero ("0") characters, followed by the given
 *   string
 * @private
 */
var zeroPad = function(string, length) {
  var digitsNeeded = length - string.length;
  if (digitsNeeded > 0)
    string = zeroRepeat(digitsNeeded) + string;
  return string;
};

// NOTE: This is exported for testing.
cryptohat._zeroPad = zeroPad;

/**
 * Special case of {@link array32ToString} when base=16.
 *
 * @see array32ToString
 * @param {Array<number>} array a big-endian representation of the number; each
 *   element in the array is a 32-bit digit; the elements in the array will be
 *   trashed
 * @param {number} base the base/radix used to represent the number
 * @param {Array<string>} digits buffer used to store an intermediate
 *   representation of the number; the elements in the array will be trashed
 * @return {string} the textual representation of the number
 * @private
 */
var array32ToHexString = function(array, base, digits) {
  // NOTE: The digits array will generally be large enough to contain
  //       everything except for possibly the first few digits in the first
  //       array element.
  var string = "";
  for (var i = 0; i < array.length; ++i) {
    // NOTE: Each 32-bit character expands to 8 hexadecimal digits.
    string += zeroPad(array[i].toString(16), 8);
  }

  var extraCharacters = string.length - digits.length;
  if (extraCharacters > 0)
    string = string.substring(extraCharacters);
  return string;
};
// NOTE: This is exported for testing.
cryptohat._array32ToHexString = array32ToHexString;


/**
 * Creates a random identifier generator.
 *
 * @private
 * @param {number} bits the desired number of bits of randomness
 * @param {number} base the base/radix used to represent the random number;
 *   must be between 2 and 36
 * @returns {function()} a generating function that returns random identifiers;
 *   the string identifiers returned by the function guaranteed to have the
 *   same length; in order to satisfy this constraint, the returned identifier
 *   might have leading zeros
 */
var newStringGenerator = function(bits, base) {
  if (base < 2 || base > 36)
    throw RangeError("The base argument must be between 2 and 36");

  var digitCount = maxDigits(bits, base);
  if (bits <= 53) {
    // Fast path where we can use JavaScript's toString().
    var numberGenerator = cryptohat.generator(bits, 0);
    return function() {
      return zeroPad(numberGenerator().toString(base), digitCount);
    };
  }

  // NOTE: We pre-allocate the arrays to hint V8 about their size and type.
  var digits = [];
  for (var i = 0; i < digitCount; ++i)
    digits[i] = "0";
  var numberCount = Math.floor((bits + 31) / 32);
  var numbers = [];
  for (var i = 0; i < numberCount; ++i)
    numbers[i] = 0;
  var stringifer = (base === 16) ? array32ToHexString : array32ToString;
  if (bits % 32 === 0) {
    return function() {
      for (var i = 0; i < numberCount; ++i)
        numbers[i] = random32();

      return stringifer(numbers, base, digits);
    };
  } else {
    mask = Math.pow(2, bits % 32) - 1;
    return function() {
      numbers[0] = random32() & mask;
      for (var i = 1; i < numberCount; ++i)
        numbers[i] = random32();

      return stringifer(numbers, base, digits);
    };
  }
};

})(this);
