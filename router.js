'use strict';

function addRoutes(routes) {
    for (let i = 0; i < routes.length; i++) {
        addRoute(...Object.values(routes[i]));
    }
}

function addRoute(route, partial, title, js = [], css = [], preload = []) {
    // Set the regex of the route.
    let regex;
    let variables;

    // Make sure it starts with a /.
    if (!route.startsWith('/')) route = `/${route}`;

    // If the route is a string, generate regex from it.
    regex = generateRouteRegex(route);

    // Generate the variables.
    variables = generateVariables(route);

    // Push the route and then return the class for chaining.
    window.myapp.routes.push({
        route,
        regex,
        partial,
        title,
        js,
        css,
        preload,
        variables
    });
}

function generateRouteRegex(route) {
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

function getRoute(url) {
    // Loop through the routes.
    for (let i = 0; i < window.myapp.routes.length; i++) {
        const route = window.myapp.routes[i];

        // Check regex for match.
        let matches = route.regex.exec(url);
        if (!matches) continue;

        // Get the route params.
        if (route.variables && route.variables.length) {
            let params = fetchParams(route, matches);
            if (params) window.myapp.params = params;
        }

        return route;
    }
}

function generateVariables(route) {
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
                optional: routeParams[i][routeParams[i].length - 1] === '?'
            });
        }
    }

    return variables;
}

function fetchParams(route, matches) {
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

function setLoading(value, deactivate = false) {
    // Set the loading.
    const oldValue = window.myapp.loading;
    window.myapp.loading = value;

    // Create an event and dispatch it on the window.
    const event = new CustomEvent('myapp-load-change', {
        detail: { newValue: value, oldValue, deactivate }
    });
    window.dispatchEvent(event);
}
