// Analítica opcional (Google Analytics 4).
//
// Google Analytics NO se carga hasta que la persona lo acepta expresamente en
// el aviso. Si rechaza o no responde, no se descarga el script ni se guardan
// cookies. La elección se recuerda en localStorage y se puede cambiar desde
// la política de privacidad (privacidad.html usa la misma clave).
(() => {
    'use strict';

    const GA_ID = 'G-ST5GB9GF29';
    const CONSENT_KEY = 'analyticsConsent'; // 'granted' | 'denied'

    const getConsent = () => {
        try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; }
    };
    const setConsent = (value) => {
        try { localStorage.setItem(CONSENT_KEY, value); } catch (e) { /* sin almacenamiento: se volverá a preguntar */ }
    };

    // Borra las cookies de Analytics que pudieran quedar de visitas anteriores
    function clearAnalyticsCookies() {
        const names = document.cookie.split(';')
            .map(c => c.split('=')[0].trim())
            .filter(n => n === '_ga' || n.startsWith('_ga_'));
        const host = location.hostname;
        for (const name of names) {
            for (const domain of ['', host, `.${host}`]) {
                document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ''}`;
            }
        }
    }

    let loaded = false;
    function loadAnalytics() {
        if (loaded) return;
        loaded = true;
        window.dataLayer = window.dataLayer || [];
        window.gtag = function () { window.dataLayer.push(arguments); };
        window.gtag('js', new Date());
        // La dirección de página se envía SIN parámetros: las rutas compartidas
        // llevan el origen y el destino en la query string (?origen=...&destino=...).
        // Lo mismo con la página de procedencia, por si es una URL de esta app.
        const config = { page_location: location.origin + location.pathname };
        if (document.referrer) config.page_referrer = document.referrer.split(/[?#]/)[0];
        window.gtag('config', GA_ID, config);

        const script = document.createElement('script');
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
        document.head.appendChild(script);
    }

    function showBanner() {
        const banner = document.createElement('div');
        banner.id = 'consent-banner';
        banner.setAttribute('role', 'dialog');
        banner.setAttribute('aria-label', 'Consentimiento de analítica');
        banner.className = 'position-fixed bottom-0 start-0 m-2 p-3 bg-body border rounded-3 shadow-lg';
        banner.style.cssText = 'z-index: 1055; max-width: min(400px, calc(100vw - 1rem));';
        // Los dos botones tienen el mismo peso visual: rechazar es tan fácil como aceptar.
        banner.innerHTML = `
            <p class="small mb-2">¿Nos dejas contar tu visita? Usamos Google Analytics solo para saber cuánta gente usa la app. No se activa ni guarda cookies si no aceptas. <a href="privacidad.html">Más información</a></p>
            <div class="d-flex gap-2">
                <button type="button" class="btn btn-sm btn-secondary flex-fill" data-consent="denied">Rechazar</button>
                <button type="button" class="btn btn-sm btn-secondary flex-fill" data-consent="granted">Aceptar</button>
            </div>
        `;
        banner.addEventListener('click', (e) => {
            const choice = e.target.closest('[data-consent]')?.dataset.consent;
            if (!choice) return;
            setConsent(choice);
            banner.remove();
            if (choice === 'granted') loadAnalytics();
        });
        document.body.appendChild(banner);
    }

    const consent = getConsent();
    if (consent === 'granted') {
        loadAnalytics();
    } else {
        clearAnalyticsCookies();
        if (consent !== 'denied') showBanner();
    }
})();
