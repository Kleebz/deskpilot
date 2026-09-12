<script>
  import { onDestroy } from "svelte";
  import QrScanner from "qr-scanner";

  let { onscan, onstatus } = $props();
  let video;
  let scanner;
  let scanning = $state(false);

  function stop() {
    scanner?.stop();
    scanning = false;
  }

  async function start() {
    if (scanning) return;
    if (!scanner) {
      scanner = new QrScanner(
        video,
        (result) => {
          stop();
          onscan(result.data);
        },
        {
          preferredCamera: "environment",
          returnDetailedScanResult: true,
          highlightScanRegion: true,
          highlightCodeOutline: true,
        },
      );
    }

    try {
      await scanner.start();
      scanning = true;
    } catch (e) {
      scanning = false;
      const denied = e?.name === "NotAllowedError" || /permission|denied/i.test(String(e));
      onstatus(
        denied
          ? "camera permission denied — allow it in browser settings or use the link fields"
          : "could not start the camera — use the link fields instead",
        true,
      );
    }
  }

  onDestroy(() => scanner?.destroy());
</script>

<div class="scanner">
  <video bind:this={video} class:active={scanning} playsinline muted></video>
  {#if scanning}
    <div class="scan-note">Point this camera at <code>deskpilot pair</code> on the other machine.</div>
    <button class="sm ghost" type="button" onclick={stop}>stop camera</button>
  {:else}
    <button class="scan" type="button" onclick={start}>scan QR from another machine</button>
  {/if}
</div>

<style>
  .scanner { display: grid; gap: .4rem; margin: .35rem 0; }
  video {
    display: none; width: 100%; max-height: 44vh; object-fit: cover;
    border: 1px solid var(--line); border-radius: var(--radius);
    background: #000;
  }
  video.active { display: block; }
  .scan { width: 100%; }
  .scan-note { font-size: 11px; line-height: 1.45; color: var(--dim); }
</style>
