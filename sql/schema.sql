IF OBJECT_ID(N'dbo.TenderRecords', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TenderRecords (
        RecordId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TenderRecords PRIMARY KEY,
        UniqueId NVARCHAR(32) NULL,
        Branch NVARCHAR(MAX) NULL,
        Department NVARCHAR(MAX) NULL,
        ClientName NVARCHAR(MAX) NULL,
        NumberOfLifts NVARCHAR(MAX) NULL,
        NameOfWork NVARCHAR(MAX) NULL,
        LoNumber NVARCHAR(MAX) NULL,
        ReferenceType NVARCHAR(MAX) NULL,
        ReferenceNumber NVARCHAR(MAX) NULL,
        ReferenceDate NVARCHAR(MAX) NULL,
        WorkType NVARCHAR(MAX) NULL,
        JobType NVARCHAR(MAX) NULL,
        StartDate NVARCHAR(MAX) NULL,
        EndDate NVARCHAR(MAX) NULL,
        BeneficiaryBankName NVARCHAR(MAX) NULL,
        BeneficiaryIfscCode NVARCHAR(MAX) NULL,
        TenderType NVARCHAR(MAX) NULL,
        TenderValue NVARCHAR(MAX) NULL,
        CompletionPeriod NVARCHAR(MAX) NULL,
        SubmissionDate NVARCHAR(MAX) NULL,
        DlpInMonths NVARCHAR(MAX) NULL,
        RequisitionType NVARCHAR(MAX) NULL,
        ValidUpto NVARCHAR(MAX) NULL,
        RequisitionAmount NVARCHAR(MAX) NULL,
        InFormOf NVARCHAR(MAX) NULL,
        InFavorOf NVARCHAR(MAX) NULL,
        EmdConvertedToSd NVARCHAR(MAX) NULL,
        Refundable NVARCHAR(MAX) NULL,
        PaymentTerm NVARCHAR(MAX) NULL,
        OperationRemarks NVARCHAR(MAX) NULL,
        BeneficiaryName NVARCHAR(MAX) NULL,
        BankName NVARCHAR(MAX) NULL,
        ClaimDate NVARCHAR(MAX) NULL,
        BankingRequisitionType NVARCHAR(MAX) NULL,
        ChequeNumber NVARCHAR(MAX) NULL,
        UtrDdNumber NVARCHAR(MAX) NULL,
        BankExpiryDate NVARCHAR(MAX) NULL,
        ChequeDate NVARCHAR(MAX) NULL,
        BankingAmount NVARCHAR(MAX) NULL,
        BankingRemarks NVARCHAR(MAX) NULL,
        PreparedBy NVARCHAR(MAX) NULL,
        ApprovalLoginName NVARCHAR(MAX) NULL,
        ApprovalDateTime DATETIME2(7) NULL,
        AssignedTo NVARCHAR(200) NULL,
        ApprovalStatus NVARCHAR(32) NULL,
        JobStatus NVARCHAR(32) NULL,
        ReviewedBy NVARCHAR(200) NULL,
        ReviewedAt DATETIME2(7) NULL,
        ProcessedBy NVARCHAR(200) NULL,
        ProcessedAt DATETIME2(7) NULL,
        FormData NVARCHAR(MAX) NOT NULL,
        SearchKey NVARCHAR(200) NULL,
        CreatedBy NVARCHAR(200) NULL,
        UpdatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_TenderRecords_UpdatedAt DEFAULT SYSDATETIME(),
        CONSTRAINT CK_TenderRecords_FormData_IsJson CHECK (ISJSON(FormData) = 1)
    );
END;

DECLARE @TenderColumns TABLE (ColumnName SYSNAME NOT NULL, ColumnType NVARCHAR(40) NOT NULL);
INSERT INTO @TenderColumns (ColumnName, ColumnType) VALUES
    (N'Branch', N'NVARCHAR(MAX) NULL'),
    (N'Department', N'NVARCHAR(MAX) NULL'),
    (N'ClientName', N'NVARCHAR(MAX) NULL'),
    (N'NumberOfLifts', N'NVARCHAR(MAX) NULL'),
    (N'NameOfWork', N'NVARCHAR(MAX) NULL'),
    (N'LoNumber', N'NVARCHAR(MAX) NULL'),
    (N'ReferenceType', N'NVARCHAR(MAX) NULL'),
    (N'ReferenceNumber', N'NVARCHAR(MAX) NULL'),
    (N'ReferenceDate', N'NVARCHAR(MAX) NULL'),
    (N'WorkType', N'NVARCHAR(MAX) NULL'),
    (N'JobType', N'NVARCHAR(MAX) NULL'),
    (N'StartDate', N'NVARCHAR(MAX) NULL'),
    (N'EndDate', N'NVARCHAR(MAX) NULL'),
    (N'BeneficiaryBankName', N'NVARCHAR(MAX) NULL'),
    (N'BeneficiaryIfscCode', N'NVARCHAR(MAX) NULL'),
    (N'TenderType', N'NVARCHAR(MAX) NULL'),
    (N'TenderValue', N'NVARCHAR(MAX) NULL'),
    (N'CompletionPeriod', N'NVARCHAR(MAX) NULL'),
    (N'SubmissionDate', N'NVARCHAR(MAX) NULL'),
    (N'DlpInMonths', N'NVARCHAR(MAX) NULL'),
    (N'RequisitionType', N'NVARCHAR(MAX) NULL'),
    (N'ValidUpto', N'NVARCHAR(MAX) NULL'),
    (N'RequisitionAmount', N'NVARCHAR(MAX) NULL'),
    (N'InFormOf', N'NVARCHAR(MAX) NULL'),
    (N'InFavorOf', N'NVARCHAR(MAX) NULL'),
    (N'EmdConvertedToSd', N'NVARCHAR(MAX) NULL'),
    (N'Refundable', N'NVARCHAR(MAX) NULL'),
    (N'PaymentTerm', N'NVARCHAR(MAX) NULL'),
    (N'OperationRemarks', N'NVARCHAR(MAX) NULL'),
    (N'BeneficiaryName', N'NVARCHAR(MAX) NULL'),
    (N'BankName', N'NVARCHAR(MAX) NULL'),
    (N'ClaimDate', N'NVARCHAR(MAX) NULL'),
    (N'BankingRequisitionType', N'NVARCHAR(MAX) NULL'),
    (N'ChequeNumber', N'NVARCHAR(MAX) NULL'),
    (N'UtrDdNumber', N'NVARCHAR(MAX) NULL'),
    (N'BankExpiryDate', N'NVARCHAR(MAX) NULL'),
    (N'ChequeDate', N'NVARCHAR(MAX) NULL'),
    (N'BankingAmount', N'NVARCHAR(MAX) NULL'),
    (N'BankingRemarks', N'NVARCHAR(MAX) NULL'),
    (N'PreparedBy', N'NVARCHAR(MAX) NULL'),
    (N'ApprovalLoginName', N'NVARCHAR(MAX) NULL'),
    (N'ApprovalDateTime', N'DATETIME2(7) NULL'),
    (N'AssignedTo', N'NVARCHAR(200) NULL'),
    (N'ApprovalStatus', N'NVARCHAR(32) NULL'),
    (N'JobStatus', N'NVARCHAR(32) NULL'),
    (N'ReviewedBy', N'NVARCHAR(200) NULL'),
    (N'ReviewedAt', N'DATETIME2(7) NULL'),
    (N'ProcessedBy', N'NVARCHAR(200) NULL'),
    (N'ProcessedAt', N'DATETIME2(7) NULL');

DECLARE @ColumnName SYSNAME;
DECLARE @ColumnType NVARCHAR(40);
DECLARE @AlterColumnSql NVARCHAR(MAX);
DECLARE TenderColumnCursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT ColumnName, ColumnType FROM @TenderColumns;
OPEN TenderColumnCursor;
FETCH NEXT FROM TenderColumnCursor INTO @ColumnName, @ColumnType;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF COL_LENGTH(N'dbo.TenderRecords', @ColumnName) IS NULL
    BEGIN
        SET @AlterColumnSql = N'ALTER TABLE dbo.TenderRecords ADD ' + QUOTENAME(@ColumnName) + N' ' + @ColumnType + N';';
        EXEC(@AlterColumnSql);
    END;
    FETCH NEXT FROM TenderColumnCursor INTO @ColumnName, @ColumnType;
END;
CLOSE TenderColumnCursor;
DEALLOCATE TenderColumnCursor;

IF COL_LENGTH(N'dbo.TenderRecords', N'UniqueId') IS NULL
BEGIN
    ALTER TABLE dbo.TenderRecords ADD UniqueId NVARCHAR(32) NULL;
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.TenderRecords') AND name = N'UX_TenderRecords_UniqueId'
)
BEGIN
    EXEC(N'
        CREATE UNIQUE INDEX UX_TenderRecords_UniqueId
        ON dbo.TenderRecords (UniqueId)
        WHERE UniqueId IS NOT NULL;
    ');
END;

IF OBJECT_ID(N'dbo.TenderFieldSettings', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TenderFieldSettings (
        Id TINYINT NOT NULL CONSTRAINT PK_TenderFieldSettings PRIMARY KEY,
        SettingsJson NVARCHAR(MAX) NOT NULL,
        UpdatedBy NVARCHAR(100) NOT NULL,
        UpdatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_TenderFieldSettings_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_TenderFieldSettings_Singleton CHECK (Id = 1),
        CONSTRAINT CK_TenderFieldSettings_SettingsJson_IsJson CHECK (ISJSON(SettingsJson) = 1)
    );
END;

IF OBJECT_ID(N'dbo.TenderTabAccessSettings', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TenderTabAccessSettings (
        Id TINYINT NOT NULL CONSTRAINT PK_TenderTabAccessSettings PRIMARY KEY,
        SettingsJson NVARCHAR(MAX) NOT NULL,
        UpdatedBy NVARCHAR(100) NOT NULL,
        UpdatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_TenderTabAccessSettings_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_TenderTabAccessSettings_Singleton CHECK (Id = 1),
        CONSTRAINT CK_TenderTabAccessSettings_SettingsJson_IsJson CHECK (ISJSON(SettingsJson) = 1)
    );
END;

IF OBJECT_ID(N'dbo.TenderUserAccessSettings', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TenderUserAccessSettings (
        Id TINYINT NOT NULL CONSTRAINT PK_TenderUserAccessSettings PRIMARY KEY,
        SettingsJson NVARCHAR(MAX) NOT NULL,
        UpdatedBy NVARCHAR(100) NOT NULL,
        UpdatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_TenderUserAccessSettings_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_TenderUserAccessSettings_Singleton CHECK (Id = 1),
        CONSTRAINT CK_TenderUserAccessSettings_SettingsJson_IsJson CHECK (ISJSON(SettingsJson) = 1)
    );
END;

IF OBJECT_ID(N'dbo.TenderAppearanceSettings', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TenderAppearanceSettings (
        Id TINYINT NOT NULL CONSTRAINT PK_TenderAppearanceSettings PRIMARY KEY,
        SettingsJson NVARCHAR(MAX) NOT NULL,
        UpdatedBy NVARCHAR(100) NOT NULL,
        UpdatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_TenderAppearanceSettings_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_TenderAppearanceSettings_Singleton CHECK (Id = 1),
        CONSTRAINT CK_TenderAppearanceSettings_SettingsJson_IsJson CHECK (ISJSON(SettingsJson) = 1)
    );
END;
