/* Speedy's service worker: only My PC's Drive streaming worker (MyPC.drive.stream, sdk/GUIDE.md section 19). The web player asks
 * ./__mypc_drive/<token> for Range pieces of a Google Drive film; this worker answers them with pieces read through My PC. */
importScripts('https://pc.geekspro.us/sdk/drive-sw.js');
