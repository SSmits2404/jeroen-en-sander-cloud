const CircuitBreaker = require('opossum');

/**
 * Maakt een herbruikbare Circuit Breaker aan.
 * @param {Function} requestFunction - De async functie die de service aanroept.
 * @param {Object} options - Specifieke overrides voor de breaker (optioneel).
 */
const createBreaker = (requestFunction, options = {}) => {
    const defaultOptions = {
        timeout: 5000,                // Hoe lang wachten op antwoord?
        errorThresholdPercentage: 50, // Open de breaker bij 50% fouten
        resetTimeout: 10000           // Wacht 10 seconden voor retry
    };

    const breaker = new CircuitBreaker(requestFunction, { ...defaultOptions, ...options });

    // Monitoring logica voor de breaker events
    breaker.on('open', () => console.log('!!! CIRCUIT BREAKER: OPEN (Circuit verbroken) !!!'));
    breaker.on('close', () => console.log('!!! CIRCUIT BREAKER: CLOSED (Normale werking) !!!'));
    breaker.on('halfOpen', () => console.log('!!! CIRCUIT BREAKER: HALF-OPEN (Testen...) !!!'));

    return breaker;
};

module.exports = createBreaker;