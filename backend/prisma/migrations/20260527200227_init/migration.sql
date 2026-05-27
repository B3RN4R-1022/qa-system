-- CreateTable
CREATE TABLE "QATask" (
    "id" TEXT NOT NULL,
    "asanaId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "previewUrl" TEXT,
    "assignee" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QATask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QACheck" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "QACheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QATask_asanaId_key" ON "QATask"("asanaId");

-- AddForeignKey
ALTER TABLE "QACheck" ADD CONSTRAINT "QACheck_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "QATask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
