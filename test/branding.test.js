/* Who this deployment is for, as a setting rather than as markup.
 *
 * The employer was spelled into four screens until 2026-09-24. The owner asked
 * for it to be configurable "to avoid potential hiccups in the future", which
 * is the same reasoning that took "Hendrickson · Navarre" off the login card in
 * the first place -- before he reversed that and asked for both to stay and
 * both to become settings.
 *
 * The distinction these tests exist to protect is UNSET vs EMPTY. They are
 * different answers: a deployment that has not been configured should look
 * exactly like today's, and a deployment that deliberately has no client mark
 * should render no mark at all rather than a broken image. Collapsing the two
 * -- by treating `''` as falsy and falling back -- would make "no logo" an
 * unreachable state, and nothing on screen would say why.
 */
import { describe, expect, it } from 'vitest';
import { clientLogo, clientLogoAlt, clientName } from '../src/lib/branding.js';

describe('client branding settings', () => {
  it('falls back to the current deployment when nothing is configured', () => {
    expect(clientName({})).toBe('Hendrickson · Navarre');
    expect(clientLogo({})).toBe('/hendrickson-logo.jpg');
  });

  it('treats an undefined env the same as an unset variable', () => {
    expect(clientName(undefined)).toBe('Hendrickson · Navarre');
    expect(clientLogo(undefined)).toBe('/hendrickson-logo.jpg');
  });

  it('takes a configured value', () => {
    expect(clientName({ VITE_CLIENT_NAME: 'Acme · Toledo' })).toBe('Acme · Toledo');
    expect(clientLogo({ VITE_CLIENT_LOGO: '/acme.png' })).toBe('/acme.png');
  });

  it('treats EMPTY as a deliberate none, not as unset', () => {
    // The whole point: a client with no mark, or no site line, is a real
    // deployment. Falling back here would make that impossible to express.
    expect(clientName({ VITE_CLIENT_NAME: '' })).toBe('');
    expect(clientLogo({ VITE_CLIENT_LOGO: '' })).toBe('');
  });

  it('trims, because an env file is edited by hand', () => {
    expect(clientName({ VITE_CLIENT_NAME: '  Acme · Toledo  ' })).toBe('Acme · Toledo');
    expect(clientLogo({ VITE_CLIENT_LOGO: '  /acme.png ' })).toBe('/acme.png');
    // And whitespace alone is emptiness, not a one-space client name.
    expect(clientName({ VITE_CLIENT_NAME: '   ' })).toBe('');
  });

  it('derives the mark alt text from the name, without the site', () => {
    // Two settings that can disagree would ship a screen reader announcing the
    // wrong company, so the alt text is derived rather than configured.
    expect(clientLogoAlt({})).toBe('Hendrickson');
    expect(clientLogoAlt({ VITE_CLIENT_NAME: 'Acme · Toledo' })).toBe('Acme');
    expect(clientLogoAlt({ VITE_CLIENT_NAME: 'Acme' })).toBe('Acme');
  });

  it('still names the image when the client name is blank', () => {
    // A deployment can have a mark and no site line. Alt text is not optional.
    expect(clientLogoAlt({ VITE_CLIENT_NAME: '' })).toBe('Client logo');
  });
});
