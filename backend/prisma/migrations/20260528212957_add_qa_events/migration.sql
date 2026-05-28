-- CreateTable
CREATE TABLE "QAEvent" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "projectName" TEXT,
    "assignee" TEXT,
    "wasFirstApproval" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QAEvent_pkey" PRIMARY KEY ("id")
);
