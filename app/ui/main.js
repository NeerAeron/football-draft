// Entry point of app/index.html: apply preferences, start the router, render the shell.
import { render } from 'preact';
import './lib/motion.js'; // applies html[data-motion] before first paint of the app
import { mountApp } from './shell/app.js';
import { routes } from './routes.js';
import { registerOffline } from './lib/offline.js';

const root = document.getElementById('app');
root.replaceChildren(); // drop the static boot splash
mountApp(root, render);
registerOffline(routes); // service worker for offline play (not on localhost unless ?sw=1)
