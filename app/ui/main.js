// Entry point of app/index.html: apply preferences, start the router, render the shell.
import { render } from 'preact';
import './lib/motion.js'; // applies html[data-motion] before first paint of the app
import { mountApp } from './shell/app.js';

const root = document.getElementById('app');
root.replaceChildren(); // drop the static boot splash
mountApp(root, render);
