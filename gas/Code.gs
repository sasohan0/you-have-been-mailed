/**
 * "You Have Been Mailed" - Google Apps Script Backend (v1 Core)
 */
const PIXEL_BASE64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function doGet(e) {
  const output = Utilities.base64Decode(PIXEL_BASE64);
  return ContentService.createTextOutput(Utilities.newBlob(output, "image/gif").getDataAsString())
    .setMimeType(ContentService.MimeType.TEXT);
}
