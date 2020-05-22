'use strict';

// The load states for the framework.
const MYAPP_LOAD_STATES = {
    FETCHING_ROUTE: 'FETCHING_ROUTE',
    RELOADING_LINKS: 'RELOADING_LINKS',
    RELOADING_SCRIPTS: 'RELOADING_SCRIPTS',
    LOADING_HTML: 'LOADING_HTML',
    OVERRIDING_HREF: 'OVERRIDING_HREF',
    PRELOADING_ROUTE: 'PRELOADING_ROUTE',
};

// Create a holder object to store globals.
window.myapp = {
    loading: false,
    current: null,
    currentRoute: null,
    routes: [],
    params: [],
    loadStates: [],
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
window.addEventListener('myapp-load-change', (e) => {
    if (!e.detail.newValue && !e.detail.deactivate) {
        if ('onActivate' in window && window.onActivate) {
            window.onActivate();
        }
    }
});

/**
 * This function takes a local page location, for example `/route`, and attempts to load it.
 *
 * @param {string} page The local page to load.
 * @returns {Promise<boolean>} A `Promise` containing a `boolean` determining if it successfully loaded the page.
 */
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
    _fireLoadEvent(MYAPP_LOAD_STATES.FETCHING_ROUTE);

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

    _fireLoadEvent(MYAPP_LOAD_STATES.RELOADING_LINKS);

    // Reload Link tags.
    let tagsToRemove = await _reloadTags('link', route.css);

    _fireLoadEvent(MYAPP_LOAD_STATES.OVERRIDING_HREF);

    // Override a tags.
    _overrideAllHref();

    _fireLoadEvent(MYAPP_LOAD_STATES.RELOADING_SCRIPTS);

    // Reload script tags.
    tagsToRemove.push(...(await _reloadTags('script', route.js)));

    _fireLoadEvent(MYAPP_LOAD_STATES.PRELOADING_ROUTE);

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

    _fireLoadEvent(MYAPP_LOAD_STATES.LOADING_HTML);

    // Fetch the partial.
    const partial = await fetch(`partials/${route.partial}`);
    const html = await partial.text();
    document.getElementById('myapp-main').innerHTML = html;

    // Remove all the tags.
    for (let i = 0; i < tagsToRemove.length; i++) {
        tagsToRemove[i].baseElement.removeChild(tagsToRemove[i].element);
    }

    setLoading(false);

    return true;
}

/**
 * This function reloads the tags on the page, returning the old non-duplicate
 * (ones that are not going to be used in the new page) tags to remove from the page
 * and inserts the new tags into the page.
 *
 * This function also waits for all of the script/link tags to load before returning.
 *
 * @param {'script' | 'link'} type The type of tag to reload. Can either be script or link.
 * @param {string[]} urls An array of urls for the tag (for script it is src, for link it is href).
 * @returns {Promise<{ element: HTMLScriptElement | HTMLLinkElement; baseElement: HTMLElement; }[]>}
 * The list of tags to remove from the page.
 */
async function _reloadTags(type, urls) {
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
    const load = (url) => {
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
    return toRemove.map((remove) => {
        return { element: remove, baseElement: element };
    });
}

/**
 * This function transforms the onclick function on every element with the attribute
 * `my-href` into a function that loads a new page given the value of the `my-href` attribute.
 *
 * Note, this new function also preventsDefault on the element.
 */
function _overrideAllHref() {
    // Get all the tags with my-href attribute.
    const hrefElements = document.querySelectorAll('[my-href]');

    // Loop through and override the click.
    for (let i = 0; i < hrefElements.length; i++) {
        const href = hrefElements[i].getAttribute('my-href');

        hrefElements[i].setAttribute('href', href);

        hrefElements[i].onclick = (e) => {
            e.preventDefault();

            loadPage(href);
        };
    }
}

/**
 * This function removes a given function/variable from the window object.
 * Mainly used for internal framework functionality (for example removing the
 * onActivate/onDeactivate functions before loading a new page).
 *
 * @param {string} name The name of the function/variable to remove from the window.
 */
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

/**
 * This function just calls addRoute on every element in the array.
 *
 * @param {Object[]} routes The routes to add to the framework router.
 */
function addRoutes(routes) {
    for (let i = 0; i < routes.length; i++) {
        addRoute(...Object.values(routes[i]));
    }
}

/**
 * This function adds a route to the internal router. This will generate the regex for the route,
 * generate the route parameters (which will be available to use via `window.myapp.params` once the route is loaded),
 * and add the route to the global `window.myapp.routes` array.
 *
 * @param {string} route The route to add to the router (for example `/route`).
 * @param {string} partial The partial that the route will use (for example `index.html`).
 * @param {string} title The default title the route will use when loading the page.
 * @param {string[]} js An array of javascript files the route will use.
 * @param {string[]} css An array of css files the route will use.
 * @param {string[]} preload An array of function names that the route will fire before setting loading back to false.
 */
function addRoute(route, partial, title, js = [], css = [], preload = []) {
    // Set the regex of the route.
    let regex;
    let variables;

    // Make sure it starts with a /.
    if (!route.startsWith('/')) route = `/${route}`;

    // If the route is a string, generate regex from it.
    regex = _generateRouteRegex(route);

    // Generate the variables.
    variables = _generateVariables(route);

    // Push the route and then return the class for chaining.
    window.myapp.routes.push({
        route,
        regex,
        partial,
        title,
        js,
        css,
        preload,
        variables,
    });
}

/**
 * This function generates regex to use for fetching the route and getting the parameters from the route
 * during the finding process for the router.
 *
 * @param {string} route The route to generate the regex on.
 * @returns {RegExp} The generated regex.
 */
function _generateRouteRegex(route) {
    // Variables for string interpolation.
    let leadingSlash = route[route.length - 1] === '/' ? '' : '/?';

    // Generate the regex with regex replace and string interpolation.
    return new RegExp(
        `^${
            route
                .replace(/\*/g, '.+') // Handle wildcards.
                .replace(/\/([0-9a-zA-Z]+)/g, '/($1)') // Add group to normal params.
                .replace(/:.+?(\?)?(\/|$)/g, '([^/]+$2)$1') // Replace the variables to work with any text.
        }${leadingSlash}$`
    );
}

/**
 * This function fires the regex on each route to check if the url matches.
 * If there is a matching route, the route is returned.
 *
 * @param {string} url The url to check for the routes with.
 * @returns {Object | null} The route on success, or null if no matches.
 */
function getRoute(url) {
    // Loop through the routes.
    for (let i = 0; i < window.myapp.routes.length; i++) {
        const route = window.myapp.routes[i];

        // Check regex for match.
        let matches = route.regex.exec(url);
        if (!matches) continue;

        // Get the route params.
        if (route.variables && route.variables.length) {
            let params = _fetchParams(route, matches);
            if (params) window.myapp.params = params;
        }

        return route;
    }

    return null;
}

/**
 * This function takes a route and generates an array of the nicely formatted variables.
 * These variables make it easier on the route finding to match the variables to the URL values.
 *
 * @param {string} route The route to generate the variables for.
 * @returns {{ index: number; name: string; optional: boolean; }[]} An array of variable objects.
 */
function _generateVariables(route) {
    let variables = [];

    // Get the route/raw params.
    let routeParams = route.split('/');
    routeParams.shift();

    // Loop through the routeParams.
    for (let i = 0; i < routeParams.length; i++) {
        // If the param is a variable.
        if (routeParams[i][0] === ':') {
            let name = routeParams[i].replace(/:(.+?)(\?|$)/, '$1');

            variables.push({
                index: i + 1,
                name,
                optional: routeParams[i][routeParams[i].length - 1] === '?',
            });
        }
    }

    return variables;
}

/**
 * This function takes the route and the regex exec result and maps each variable in
 * the route to the corresponding URL value.
 *
 * @param {Object} route The route to fetch variables for.
 * @param {RegExpExecArray} matches The regex matches from exec.
 */
function _fetchParams(route, matches) {
    if (!route.variables) {
        throw Error('No variables, function should not have been called.');
    }

    let params = [];

    // Loop through the compiled variables.
    for (let i = 0; i < route.variables.length; i++) {
        // If the match is not undefined, set it.
        if (matches[route.variables[i].index]) {
            // Decode the URI characters and remove slashes.
            try {
                params[route.variables[i].name] = decodeURIComponent(
                    matches[route.variables[i].index].replace(/\//g, '')
                );
            } catch (e) {
                throw Error(
                    'Unexpected error while decoding the URI component.'
                );
            }
        }
    }

    return params;
}

/**
 * This function sets the loading property of the global `window.myapp` object
 * and fires a custom event on the window called `myapp-load-change`.
 *
 * @param {boolean} value The value to set loading to.
 * @param {boolean} deactivate If the event was from a deactivate failure.
 */
function setLoading(value, deactivate = false) {
    // Set the loading.
    const oldValue = window.myapp.loading;
    window.myapp.loading = value;

    // Create an event and dispatch it on the window.
    const event = new CustomEvent('myapp-load-change', {
        detail: { newValue: value, oldValue, deactivate },
    });
    window.dispatchEvent(event);
}

/**
 * This function fires a `myapp-load-event` from the window with the given type.
 *
 * @param {string} type The loading event type.
 */
function _fireLoadEvent(type) {
    // Create an event and dispatch it on the window.
    const event = new CustomEvent('myapp-load-event', { detail: type });
    window.dispatchEvent(event);
}
