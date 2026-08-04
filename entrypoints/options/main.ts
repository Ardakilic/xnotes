import './style.css';
import { mountManager } from './manager';
import { mountOnboarding } from './onboarding';
import { mountSettings } from './settings';

const onboarding = document.querySelector<HTMLDivElement>('#onboarding');
if (onboarding !== null) mountOnboarding(onboarding);

const manager = document.querySelector<HTMLDivElement>('#manager');
if (manager !== null) mountManager(manager);

const settings = document.querySelector<HTMLDivElement>('#settings-panel');
if (settings !== null) mountSettings(settings);

if (location.hash !== '') {
  const target = document.querySelector(location.hash);
  if (target !== null) target.scrollIntoView();
}
