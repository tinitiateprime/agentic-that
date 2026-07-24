const params = new URLSearchParams(window.location.search);
const platform = params.get("platform");
const account = params.get("account");
const title = document.getElementById("lock-title");
const stopButton = document.getElementById("emergency-stop");

if (platform || account) {
  const platformLabel = platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : "Publishing";
  title.textContent = `${platformLabel} is publishing${account ? ` for ${account}` : ""}`;
}

stopButton.addEventListener("click", async () => {
  stopButton.disabled = true;
  stopButton.textContent = "Stopping…";
  await window.publishingInteractionLock.emergencyStop();
});
