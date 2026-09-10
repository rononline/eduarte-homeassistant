import {writeFileSync} from 'fs';
import {join} from 'path';
import puppeteer, {Page} from 'puppeteer';
import {TOTP} from 'totp-generator';

class EduarteAuth {
    private readonly portalUrl: string;
    private readonly headless: boolean;
    private readonly disableSandbox: boolean;
    private readonly saveData: boolean;
    private readonly debugDir: string | undefined;

    constructor(
        portalUrl: string,
        headless: boolean = true,
        saveData: boolean = false,
        disableSandbox: boolean = false,
        debugDir?: string
    ) {
        this.portalUrl = portalUrl;
        this.headless = headless;
        this.saveData = saveData;
        this.disableSandbox = disableSandbox;
        this.debugDir = debugDir;
    }

    /**
     * Saves what the browser was looking at when the login failed.
     *
     * Running headless there is no other way to tell an unexpected consent
     * screen apart from a wrong password, so both the rendered page and the
     * markup are written out.
     */
    private async captureFailure(page: Page) {
        if (!this.debugDir) return;

        try {
            await page.screenshot({path: join(this.debugDir, 'login-error.png'), fullPage: true});
            writeFileSync(join(this.debugDir, 'login-error.html'), await page.content(), 'utf8');
            console.log(`Saved the failing login page to ${join(this.debugDir, 'login-error.png')} and .html.`);
        } catch (captureError) {
            console.log(`Could not capture the failing login page: ${captureError}`);
        }
    }

    /**
     * Microsoft interrupts the redirect back to Eduarte with a "Stay signed in?"
     * prompt. Answering yes, and ticking "don't show this again", keeps the
     * stored browser profile signed in so later refreshes skip the whole flow.
     *
     * The prompt is recognised by its checkbox: the Yes button reuses the same
     * id (#idSIButton9) as the submit button on the email and password screens.
     */
    private async acceptStaySignedIn(page: Page) {
        const seen = await Promise.race([
            page.waitForSelector('img[alt="EduArtelogo"]', {timeout: 30000})
                .then(() => 'portal' as const).catch(() => null),
            page.waitForSelector('#KmsiCheckboxField', {timeout: 30000})
                .then(() => 'stay-signed-in' as const).catch(() => null),
        ]);

        if (seen !== 'stay-signed-in') return;

        if (this.saveData) {
            await page.click('#KmsiCheckboxField').catch(() => undefined);
        }

        await page.click('#idSIButton9');
    }

    async loginEduarte(username: string, password: string) {
        const browser = await puppeteer.launch(this.getBrowserProperties());
        const page = (await browser.pages())[0];

        try {
            // open portal url.
            await page.goto(this.portalUrl);

            // fill in username
            await page.waitForSelector('input[name="gebruikersnaam"]', {timeout: 20000});
            await page.type('input[name="gebruikersnaam"]', username);

            // fill in password and press enter
            await page.waitForSelector('input[name="wachtwoord"]', {timeout: 20000})
            await page.type('input[name="wachtwoord"]', password);
            await page.keyboard.press('Enter');

            // wait until eduarte page is loaded.
            await page.waitForSelector('img[alt="EduArtelogo"]', {timeout: 5000});

            let cookies = await page.cookies();

            if (cookies.length === 0) {
                throw new Error("There are no cookies after login.");
            }

            // successfully logged in, now format cookies.
            return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ")
        } catch (ex) {
            await this.captureFailure(page);
            throw new Error(`Failed to get cookies: ${ex}`);
        } finally {
            await browser.close();
        }

    }

    async loginMicrosoft(email: string, password: string, totpSecret: string | null) {
        const browser = await puppeteer.launch(this.getBrowserProperties());
        const page = (await browser.pages())[0];

        try {
            // open portal url.
            await page.goto(this.portalUrl);
            await page.waitForNetworkIdle();

            // if the eduarte logo is not visible.
            if (!await page.$('img[alt="EduArtelogo"]')) {
                let skipEmail = false;
                let skipPassword = false;

                if (this.saveData) {
                    // skip email when password field is visible.
                    const isPasswordFieldHidden = await page.evaluate(el =>
                        el?.hasAttribute('aria-hidden'), await page.$('input[type="password"]'));
                    const isOTCHidden = await page.evaluate(el =>
                            el === null || el.hasAttribute('aria-hidden'),
                        await page.$('input[name="otc"]')
                    );

                    if (!isPasswordFieldHidden) {
                        skipEmail = true;
                    } else if (!isOTCHidden) {
                        skipEmail = true;
                        skipPassword = true;
                    } else if (await page.$(`div[id="otherTileText"]`)) {
                        // we need to login again, use the account selector.
                        if (await page.$(`div[data-test-id="${email}"]`)) {
                            await page.click(`div[data-test-id="${email}"]`);
                            skipEmail = true;
                        } else {
                            // the email was not found in the list. proceed with normal login.
                            await page.click(`div[id="otherTileText"]`);
                            skipEmail = false;
                        }
                    }
                }

                if (!skipEmail) {
                    // fill in email and press enter
                    await page.waitForFunction(() => {
                        const element = document.querySelector('input[type="email"]');
                        return element && !element.hasAttribute('aria-hidden');
                    }, {timeout: 10000});
                    await page.type('input[type="email"]', email);
                    await page.keyboard.press('Enter');
                }

                if (!skipPassword) {
                    // fill in password when field is shown and press enter
                    await page.waitForFunction(() => {
                        const element = document.querySelector('input[type="password"]');
                        return element && !element.hasAttribute('aria-hidden');
                    }, {timeout: 10000});
                    await page.type('input[type="password"]', password);
                    await page.keyboard.press('Enter');

                }

                if (totpSecret) {
                    let otpCode = TOTP.generate(totpSecret).otp;

                    // fill in otp code when field is shown and press enter
                    await page.waitForFunction(() => {
                        const element = document.querySelector('input[name="otc"]');
                        return element && !element.hasAttribute('aria-hidden');
                    }, {timeout: 10000});

                    await page.type('input[name="otc"]', otpCode);
                    await page.keyboard.press('Enter');
                }

                await this.acceptStaySignedIn(page);

                // wait until eduarte page is loaded.
                await page.waitForSelector('img[alt="EduArtelogo"]', {timeout: 30000});
            }

            let cookies = await page.cookies();

            if (cookies.length === 0) {
                throw new Error("There are no cookies after login.");
            }

            // successfully logged in, now format cookies.
            return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ")
        } catch (ex) {
            console.log(ex);
            await this.captureFailure(page);
            throw new Error(`Failed to get cookies: ${ex}`);
        } finally {
            await browser.close();
        }
    }

    private getBrowserProperties() {
        return {
            headless: this.headless,
            args: [
                ...(this.headless ? ["--window-position=-2400,-2400"] : []),
                ...(this.disableSandbox ? ["--no-sandbox"] : []),
            ],
            // keeping the profile lets Microsoft remember the device, which avoids
            // a fresh 2FA challenge on every login.
            ...(this.saveData && {userDataDir: join(this.debugDir ?? './data', 'browser-profile')}),
        }
    }

}


export {EduarteAuth};
