// Reviewed source boundaries. These identifiers do not grant storage/lifecycle authority.
export const exportStorageIds1: string[] = [
  // Composition forwards existing storage effects; it does not supply case authority.
  "sourceReview:src/features/privacy/exportArchiveStage.ts#09039b41c86eb25cc5cd0f7b419795857ab45332569f2576ae51592de2aeb543",
  "sourceReview:src/features/privacy/exportArchiveStageTypes.ts#f1203792160389816243f5c0192b9d42d5f0dd1b53a19ee634629762ecf371a8",
  "derived:src/features/privacy/exportObjectStore.ts",
  "writer:src/features/privacy/exportObjectStore.ts#delete:uploadId",
  "writer:src/features/privacy/exportObjectStore.ts#delete:dynamic",
  "writer:src/features/privacy/exportObjectStoreObjects.ts#removeObject:dynamic",
  "writer:src/features/privacy/exportObjectStoreParts.ts#update:payload",
  "objectNamespace:src/features/privacy/exportObjectStoreRefs.ts#exportObjectKey",
  "external:src/features/privacy/exportObjectStoreTransport.ts#http.request",
  "external:src/features/privacy/exportObjectStoreTransport.ts#https.request",
  "sourceReview:src/features/privacy/exportObjectStore.ts#84fbbfc071b587dd718d24ba24baf7cbaff3774cf364e4e67235343a95f3452f",
  "sourceReview:src/features/privacy/exportObjectStoreObjects.ts#19dcfc32723787035a7c235d57873c3e4d2bab0fbfd8f4ef3c6685c181e27687",
  "sourceReview:src/features/privacy/exportObjectStoreParts.ts#7e9742f26297c654d29fce1bc01542b02a3da5f04eff0c74f0d1633735ba9812",
  "sourceReview:src/features/privacy/exportObjectStoreRefs.ts#002262cc73fff209e9dc72647ee12b41e70d92455fe7aa24d1af9785a38c762b",
  "sourceReview:src/features/privacy/exportObjectStoreTransport.ts#b2ecab02d98b7b723887def6cf84b9a9b9b2a9439b609fb02e336646333121e0",
  // Contract and SDK effects not independently emitted by the conservative scanner.
  "sourceReview:src/features/privacy/exportObjectStoreTypes.ts#6517d5bb3292576ed91442fde7f59554ceccbf0821cf276d700e909f12a3c2ca",
  "writer:src/features/privacy/exportObjectStore.ts#initiateNewMultipartUpload:configured_sdk",
  "writer:src/features/privacy/exportObjectStore.ts#completeMultipartUpload:configured_sdk",
  "writer:src/features/privacy/exportObjectStore.ts#abortMultipartUpload:configured_sdk",
  "writer:src/features/privacy/exportObjectStoreParts.ts#uploadPart:configured_sdk",
  "writer:src/features/privacy/exportObjectStoreObjects.ts#removeObject:configured_sdk",
];
