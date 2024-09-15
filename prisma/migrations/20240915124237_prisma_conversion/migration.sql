-- CreateTable
CREATE TABLE "Service" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "url" TEXT NOT NULL,
    "imagePath" TEXT,
    "imageHash" TEXT,
    "textPath" TEXT,
    "textHash" TEXT,
    "title" TEXT,
    "headers" TEXT,
    "textSize" INTEGER,
    "numTags" INTEGER,
    "numATags" INTEGER,
    "numScriptTags" INTEGER,
    "numInputTags" INTEGER,
    "metaTags" TEXT,
    "captured" INTEGER,
    "error" INTEGER,
    "viewed" INTEGER,
    "defaultCreds" TEXT,
    "authPrompt" INTEGER,
    "notes" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "Service_url_key" ON "Service"("url");
