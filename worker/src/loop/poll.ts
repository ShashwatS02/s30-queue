export async function startPolling() {
  console.log("worker started");

  setInterval(async () => {
    console.log("poll tick");
  }, 3000);
}
