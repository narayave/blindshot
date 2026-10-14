import {
  BlobSASPermissions,
  BlobServiceClient,
  ContainerSASPermissions,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob";

// Azure Data Lake Gen2 (or any Blob account). Files never pass through the app server on upload:
// the phone PUTs straight to a short-lived, write-only SAS URL for one exact path.
const account = process.env.AZURE_STORAGE_ACCOUNT ?? "";
const key = process.env.AZURE_STORAGE_KEY ?? "";
const baseUrl = process.env.AZURE_STORAGE_URL ?? `https://${account}.blob.core.windows.net`; // override for Azurite
const protocol = baseUrl.startsWith("https") ? SASProtocol.Https : SASProtocol.HttpsAndHttp;

let svc: BlobServiceClient | undefined;
let cred: StorageSharedKeyCredential | undefined;
function client() {
  cred ??= new StorageSharedKeyCredential(account, key);
  svc ??= new BlobServiceClient(baseUrl, cred);
  return { svc, cred };
}

const minutes = (m: number) => new Date(Date.now() + m * 60_000);

/** Create + write only, one blob, 10 minutes. */
export function uploadUrl(container: string, path: string): string {
  const { svc, cred } = client();
  const sas = generateBlobSASQueryParameters(
    { containerName: container, blobName: path, permissions: BlobSASPermissions.parse("cw"), expiresOn: minutes(10), protocol },
    cred,
  ).toString();
  return `${svc.getContainerClient(container).getBlobClient(path).url}?${sas}`;
}

/** One read-only SAS for a whole container, reused to build many image URLs. */
export function readUrls(container: string, ttlMinutes = 120): (path: string) => string {
  const { svc, cred } = client();
  const sas = generateBlobSASQueryParameters(
    { containerName: container, permissions: ContainerSASPermissions.parse("r"), expiresOn: minutes(ttlMinutes), protocol },
    cred,
  ).toString();
  const c = svc.getContainerClient(container);
  return (path) => `${c.getBlobClient(path).url}?${sas}`;
}

export async function download(container: string, path: string): Promise<Buffer> {
  return client().svc.getContainerClient(container).getBlobClient(path).downloadToBuffer();
}

export async function upload(container: string, path: string, body: Buffer, contentType: string): Promise<void> {
  await client()
    .svc.getContainerClient(container)
    .getBlockBlobClient(path)
    .uploadData(body, { blobHTTPHeaders: { blobContentType: contentType } });
}

export { client as storageClient };
