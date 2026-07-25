# Deploying gc.alexhornstein.com

Static site served straight from `/home/japhy/gc.alexhornstein.com`.
These steps need root, so run them yourself (in this session prefix with `!`, e.g. `!sudo ...`).

## 1. DNS
Point `gc.alexhornstein.com` at this server (A record → same IP as the other
`*.alexhornstein.com` hosts). Certbot in step 3 needs this to resolve first.

## 2. Enable the HTTP vhost
```
sudo cp /home/japhy/gc.alexhornstein.com/deploy/gc.alexhornstein.com.conf \
        /etc/apache2/sites-available/gc.alexhornstein.com.conf
sudo a2ensite gc.alexhornstein.com.conf
sudo apache2ctl configtest
sudo systemctl reload apache2
```
Now `http://gc.alexhornstein.com` should serve the site.

## 3. Add HTTPS (Let's Encrypt)
```
sudo certbot --apache -d gc.alexhornstein.com
```
Certbot writes `gc.alexhornstein.com-le-ssl.conf`, installs the cert, and adds the
HTTP→HTTPS redirect automatically (same pattern as the other subdomains here).

## Notes
- `model/` was `chmod 755` so Apache (www-data) can read the `.obj/.mtl/.jpg`.
- three.js and Leaflet load from CDNs; no build step or running process.
- Reverse geocoding uses the public Nominatim API from the browser.
