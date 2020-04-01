'use strict';

// Create a holder object to store globals.
window.myapp = {
    loading: false,
    current: null,
    currentRoute: null,
    routes: [],
    params: []
};

// Add event listener on the popstate.
window.addEventListener('popstate', () => {
    if (window.location.pathname !== window.myapp.current) {
        loadPage(window.location.pathname);
    }
});

// Add listener to load.
window.addEventListener('load', async () => {
    const path = window.location.pathname;

    await loadPage(path);
});

// Add listener to load change.
window.addEventListener('myapp-load-change', e => {
    if (!e.detail.newValue && !e.detail.deactivate) {
        if ('onActivate' in window && window.onActivate) {
            window.onActivate();
        }
    }
});

async function loadPage(page) {
    /* If there is a current route, if onDeactivate is in the window, if onDeactivate is not falsy
    and if the result of the onDeactivate is false then deny loading the page. */
    if (
        window.myapp.currentRoute &&
        'onDeactivate' in window &&
        window.onDeactivate &&
        !(await Promise.resolve(window.onDeactivate()))
    ) {
        setLoading(false, true);
        return false;
    }

    // Set window loading for the app.
    setLoading(true);

    // Get the route.
    const route = getRoute(page);

    // Set app globals for current page/remove onActivate.
    window.myapp.current = page;
    window.myapp.currentRoute = route;

    // Remove onActivate and onDeactivate from window.
    _removeFromWindow('onActivate');
    _removeFromWindow('onDeactivate');

    // Set default title.
    document.title = route.title;

    // Push the state to the window history.
    window.history.pushState('', route.title, page);

    let tagsToRemove = [];

    // Reload Link tags.
    tagsToRemove.push(...(await reloadTags('link', route.css)));

    // Fetch the partial.
    const partial = await fetch(`partials/${route.partial}`);
    const html = await partial.text();
    document.getElementById('myapp-main').innerHTML = html;

    // Override a tags.
    _overrideAllHref();

    // Reload script tags.
    tagsToRemove.push(...(await reloadTags('script', route.js)));

    // Remove all the tags.
    for (let i = 0; i < tagsToRemove.length; i++) {
        tagsToRemove[i].baseElement.removeChild(tagsToRemove[i].element);
    }

    // Check if they have preload functions.
    let preloadPromises = [];
    if (route.preload && route.preload.length) {
        for (let i = 0; i < route.preload.length; i++) {
            if (route.preload[i].name in window) {
                if (
                    !route.preload[i].params ||
                    !route.preload[i].params.length
                ) {
                    preloadPromises.push(window[route.preload[i].name]());
                } else {
                    preloadPromises.push(
                        window[route.preload[i].name](
                            ...route.preload[i].params
                        )
                    );
                }
            }
        }
    }

    await Promise.all(preloadPromises);

    setLoading(false);

    return true;
}

async function reloadTags(type, urls) {
    // Get all the old tags.
    const tags = document.querySelectorAll(`[myapp-injected-${type}]`);
    const src = type === 'script' ? 'src' : 'href';
    const element = type === 'script' ? document.body : document.head;
    let duplicates = [];
    let toRemove = [];

    // Check if any of them are getting inserted again.
    for (let i = 0; i < tags.length; i++) {
        if (urls.includes(tags[i][src])) {
            duplicates.push(tags[i][src]);
        } else {
            toRemove.push(tags[i]);
        }
    }

    // Function to return a promise to resolve on load.
    const load = url => {
        return new Promise((resolve, reject) => {
            // If duplicate.
            if (duplicates.includes(url)) {
                resolve();
                return;
            }

            // Insert based on type.
            if (type === 'script') {
                const script = document.createElement('script');
                script.setAttribute('myapp-injected-script', '');
                script.src = url;
                script.onload = resolve;
                element.appendChild(script);
            } else {
                const link = document.createElement('link');
                link.setAttribute('myapp-injected-link', '');
                link.rel = 'stylesheet';
                link.href = url;
                link.onload = resolve;
                element.appendChild(link);
            }
        });
    };

    // Add all tags and get promise to resolve on load.
    let promises = [];
    for (let i = 0; i < urls.length; i++) {
        promises.push(load(urls[i]));
    }

    // Wait for all promises to finish.
    await Promise.all(promises);

    // Return the elements to remove.
    return toRemove.map(remove => {
        return { element: remove, baseElement: element };
    });
}

function _overrideAllHref() {
    // Get all the tags with my-href attribute.
    const hrefElements = document.querySelectorAll('[my-href]');

    // Loop through and override the click.
    for (let i = 0; i < hrefElements.length; i++) {
        const href = hrefElements[i].getAttribute('my-href');

        hrefElements[i].setAttribute('href', href);

        hrefElements[i].onclick = e => {
            e.preventDefault();

            loadPage(href);
        };
    }
}

function _removeFromWindow(name) {
    // Check if in window.
    if (name in window) {
        try {
            // Normal delete operator.
            delete window[name];
        } catch (_) {
            // Catch for IE.
            window[name] = undefined;
        }
    }
}
