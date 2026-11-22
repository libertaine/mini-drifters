export async function openTracks(page) {
  await page.locator('#tracks-open').click();
}

export async function chooseTracks(page) {
  if (await page.locator('#menu').isVisible()) {
    await page.locator('#tracks-open').focus();
    await page.keyboard.press('Enter');
  }
}

export async function startTrackWithEnter(page) {
  await chooseTracks(page);
  await page.keyboard.press('Enter');
}
