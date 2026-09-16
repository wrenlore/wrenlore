import assert from "node:assert/strict";
import { StarterKit } from "@tiptap/starter-kit";
import { getAccessibilityDescriptionUpdate } from "../packages/editor-ext/src/lib/media-description";
import { getPastedAttachmentFileName } from "../packages/editor-ext/src/lib/media-filename";
import { TiptapImage } from "../packages/editor-ext/src/lib/image";
import { TiptapVideo } from "../packages/editor-ext/src/lib/video";
import { Drawio } from "../packages/editor-ext/src/lib/drawio";
import { Excalidraw } from "../packages/editor-ext/src/lib/excalidraw";

const {
  generateHTML,
  generateJSON,
}: {
  generateHTML: (json: any, extensions: any[]) => string;
  generateJSON: (html: string, extensions: any[]) => any;
} = require("@tiptap/html/server");

const extensions = [
  StarterKit.configure({
    codeBlock: false,
  }),
  TiptapImage,
  TiptapVideo,
  Drawio,
  Excalidraw,
];

function jsonToHtml(json: any) {
  return generateHTML(json, extensions);
}

function htmlToJson(html: string) {
  return generateJSON(html, extensions);
}

function testPastedAttachmentFileNames() {
  assert.equal(
    getPastedAttachmentFileName({
      nodeTypeName: "drawio",
      src: "https://example.test/api/files/id/diagram.drawio.svg?t=123#view",
    }),
    "diagram.drawio.svg",
  );
  assert.equal(
    getPastedAttachmentFileName({
      nodeTypeName: "image",
      src: "/api/files/id/photo.png?t=123",
    }),
    "photo.png",
  );
  assert.equal(
    getPastedAttachmentFileName({
      nodeTypeName: "excalidraw",
      src: "/api/files/id/my%20diagram.excalidraw.svg",
    }),
    "my diagram.excalidraw.svg",
  );
  assert.doesNotThrow(() =>
    getPastedAttachmentFileName({
      nodeTypeName: "attachment",
      url: "http://[bad]/api/files/id/bad%zz.zip?t=1",
    }),
  );
  assert.equal(
    getPastedAttachmentFileName({
      nodeTypeName: "attachment",
      url: "/api/files/id/bad%zz.zip?t=1",
    }),
    "bad%zz.zip",
  );
  assert.equal(
    getPastedAttachmentFileName({
      nodeTypeName: "drawio",
      src: "/api/files/id/?t=123",
    }),
    "diagram.drawio.svg",
  );
}

function testMediaDescriptions() {
  const imageHtml = jsonToHtml({
    type: "doc",
    content: [
      {
        type: "image",
        attrs: {
          src: "/api/files/image-id/photo.png",
          accessibilityDescription: "A mountain at sunrise",
        },
      },
    ],
  });
  assert.match(imageHtml, /alt="A mountain at sunrise"/);
  assert.match(
    imageHtml,
    /data-accessibility-description="A mountain at sunrise"/,
  );
  assert.equal(
    htmlToJson(
      '<img src="/api/files/image-id/photo.png" alt="legacy" data-accessibility-description="Authored image" />',
    ).content[0].attrs.accessibilityDescription,
    "Authored image",
  );

  const videoHtml = jsonToHtml({
    type: "doc",
    content: [
      {
        type: "video",
        attrs: {
          src: "/api/files/video-id/clip.mp4",
          accessibilityDescription: "Demo clip showing the dashboard",
        },
      },
    ],
  });
  assert.match(videoHtml, /aria-label="Demo clip showing the dashboard"/);
  assert.match(
    videoHtml,
    /data-accessibility-description="Demo clip showing the dashboard"/,
  );
  assert.doesNotMatch(videoHtml, /\salt=/);
  assert.equal(
    htmlToJson(
      '<video src="/api/files/video-id/clip.mp4" aria-label="Authored video"></video>',
    ).content[0].attrs.accessibilityDescription,
    "Authored video",
  );

  const diagramHtml = jsonToHtml({
    type: "doc",
    content: [
      {
        type: "drawio",
        attrs: {
          src: "/api/files/drawio-id/diagram.drawio.svg",
          title: "diagram.drawio.svg",
          accessibilityDescription: "Architecture flow diagram",
        },
      },
      {
        type: "excalidraw",
        attrs: {
          src: "/api/files/excalidraw-id/diagram.excalidraw.svg",
          title: "diagram.excalidraw.svg",
          accessibilityDescription: "Sketch of onboarding steps",
        },
      },
    ],
  });
  assert.match(diagramHtml, /data-title="diagram.drawio.svg"/);
  assert.match(diagramHtml, /alt="Architecture flow diagram"/);
  assert.match(diagramHtml, /data-title="diagram.excalidraw.svg"/);
  assert.match(diagramHtml, /alt="Sketch of onboarding steps"/);

  const legacyDiagramHtml = jsonToHtml({
    type: "doc",
    content: [
      {
        type: "drawio",
        attrs: {
          src: "/api/files/drawio-id/diagram.drawio.svg",
          title: "diagram.drawio.svg",
        },
      },
    ],
  });
  assert.match(legacyDiagramHtml, /alt="diagram.drawio.svg"/);

  assert.deepEqual(getAccessibilityDescriptionUpdate("", ["alt"]), {
    accessibilityDescription: null,
    alt: null,
  });

  const clearedVideoHtml = jsonToHtml({
    type: "doc",
    content: [
      {
        type: "video",
        attrs: {
          src: "/api/files/video-id/clip.mp4",
          accessibilityDescription: "",
        },
      },
    ],
  });
  assert.doesNotMatch(clearedVideoHtml, /aria-label/);
  assert.doesNotMatch(clearedVideoHtml, /data-accessibility-description/);
}

testPastedAttachmentFileNames();
testMediaDescriptions();

console.log("editor media regressions passed");
