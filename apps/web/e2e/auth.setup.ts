import { expect, test as setup } from '@playwright/test';
import { ROOT_PASS, ROOT_STATE } from './helpers';

/**
 * One-time project setup: turn the seeded root/123456 account into the test
 * password and save its cookie. Every spec then reuses this storageState
 * instead of driving the login form, which keeps the suite well below the
 * per-IP auth rate limit and shortens the run.
 */
setup('seed root password and persist session', async ({ request }) => {
  let res = await request.post('/api/auth/login', { data: { username: 'root', password: '123456' } });

  if (res.ok()) {
    const body = await res.json();
    if (body.data.must_change_password) {
      const patch = await request.patch('/api/me', {
        data: { old_password: '123456', password: ROOT_PASS },
      });
      expect(patch.ok(), await patch.text()).toBeTruthy();
    }
  } else {
    // Re-run against a database whose root password is already the test one.
    res = await request.post('/api/auth/login', { data: { username: 'root', password: ROOT_PASS } });
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  await request.storageState({ path: ROOT_STATE });
});