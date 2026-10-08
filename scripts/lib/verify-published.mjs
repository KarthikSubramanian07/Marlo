/** A publication can reach edge locations at different times. Every attempt runs the full gate. */
export async function verifyPublished(
  verify,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await verify();
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      await wait(20_000);
    }
  }
}
