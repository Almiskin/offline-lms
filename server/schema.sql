-- Offline-Compatible Learning Platform — Database Schema (MySQL, 3NF)
-- Run: mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS learning_platform;
USE learning_platform;

CREATE TABLE IF NOT EXISTS Users (
  UserID INT PRIMARY KEY AUTO_INCREMENT,
  FirstName VARCHAR(50) NOT NULL,
  LastName VARCHAR(50) NOT NULL,
  Email VARCHAR(100) UNIQUE NOT NULL,
  PasswordHash VARCHAR(255) NOT NULL,
  Role ENUM('Student', 'Instructor') NOT NULL DEFAULT 'Student',
  RegistrationDate DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  LastLoginDate DATETIME NULL,
  IsActive BOOLEAN DEFAULT TRUE,
  ResetToken VARCHAR(255) NULL,
  ResetTokenExpires DATETIME NULL,
  INDEX idx_email (Email),
  INDEX idx_role (Role)
);

CREATE TABLE IF NOT EXISTS Courses (
  CourseID INT PRIMARY KEY AUTO_INCREMENT,
  CourseCode VARCHAR(20) UNIQUE NOT NULL,
  Title VARCHAR(200) NOT NULL,
  Description TEXT NULL,
  InstructorID INT NOT NULL,
  CreatedDate DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  LastModifiedDate DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  IsPublished BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (InstructorID) REFERENCES Users(UserID) ON DELETE RESTRICT,
  INDEX idx_instructor (InstructorID),
  INDEX idx_published (IsPublished)
);

CREATE TABLE IF NOT EXISTS Enrollments (
  EnrollmentID INT PRIMARY KEY AUTO_INCREMENT,
  StudentID INT NOT NULL,
  CourseID INT NOT NULL,
  EnrollmentDate DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  LastAccessedDate DATETIME NULL,
  FOREIGN KEY (StudentID) REFERENCES Users(UserID) ON DELETE CASCADE,
  FOREIGN KEY (CourseID) REFERENCES Courses(CourseID) ON DELETE CASCADE,
  UNIQUE KEY unique_enrollment (StudentID, CourseID),
  INDEX idx_student (StudentID),
  INDEX idx_course (CourseID)
);

CREATE TABLE IF NOT EXISTS Modules (
  ModuleID INT PRIMARY KEY AUTO_INCREMENT,
  CourseID INT NOT NULL,
  ModuleTitle VARCHAR(200) NOT NULL,
  Description TEXT NULL,
  SequenceOrder INT NOT NULL DEFAULT 0,
  FOREIGN KEY (CourseID) REFERENCES Courses(CourseID) ON DELETE CASCADE,
  INDEX idx_course_sequence (CourseID, SequenceOrder)
);

CREATE TABLE IF NOT EXISTS Materials (
  MaterialID INT PRIMARY KEY AUTO_INCREMENT,
  ModuleID INT NOT NULL,
  Title VARCHAR(200) NOT NULL,
  MaterialType ENUM('Document', 'Image') NOT NULL,
  FileURL VARCHAR(500) NOT NULL,
  FileSize BIGINT NOT NULL,
  MimeType VARCHAR(100) NOT NULL,
  UploadDate DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  SequenceOrder INT NOT NULL DEFAULT 0,
  FOREIGN KEY (ModuleID) REFERENCES Modules(ModuleID) ON DELETE CASCADE,
  INDEX idx_module_sequence (ModuleID, SequenceOrder)
);

CREATE TABLE IF NOT EXISTS Quizzes (
  QuizID INT PRIMARY KEY AUTO_INCREMENT,
  ModuleID INT NOT NULL,
  Title VARCHAR(200) NOT NULL,
  Instructions TEXT NULL,
  ShowOneAtATime BOOLEAN DEFAULT FALSE,
  CreatedDate DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ModuleID) REFERENCES Modules(ModuleID) ON DELETE CASCADE,
  INDEX idx_module (ModuleID)
);

CREATE TABLE IF NOT EXISTS Questions (
  QuestionID INT PRIMARY KEY AUTO_INCREMENT,
  QuizID INT NOT NULL,
  QuestionText TEXT NOT NULL,
  SequenceOrder INT NOT NULL DEFAULT 0,
  FOREIGN KEY (QuizID) REFERENCES Quizzes(QuizID) ON DELETE CASCADE,
  INDEX idx_quiz_sequence (QuizID, SequenceOrder)
);

CREATE TABLE IF NOT EXISTS Options (
  OptionID INT PRIMARY KEY AUTO_INCREMENT,
  QuestionID INT NOT NULL,
  OptionText TEXT NOT NULL,
  IsCorrect BOOLEAN NOT NULL DEFAULT FALSE,
  SequenceOrder INT NOT NULL DEFAULT 0,
  FOREIGN KEY (QuestionID) REFERENCES Questions(QuestionID) ON DELETE CASCADE,
  INDEX idx_question (QuestionID)
);

CREATE TABLE IF NOT EXISTS QuizAttempts (
  AttemptID INT PRIMARY KEY AUTO_INCREMENT,
  StudentID INT NOT NULL,
  QuizID INT NOT NULL,
  ClientAttemptUUID VARCHAR(64) NOT NULL, -- generated offline, guarantees idempotent sync
  StartTime DATETIME NOT NULL,
  EndTime DATETIME NULL,
  Score DECIMAL(5,2) NULL,
  TotalPoints DECIMAL(5,2) NOT NULL DEFAULT 0,
  SyncStatus ENUM('Pending', 'Synced', 'Failed') DEFAULT 'Synced',
  FOREIGN KEY (StudentID) REFERENCES Users(UserID) ON DELETE CASCADE,
  FOREIGN KEY (QuizID) REFERENCES Quizzes(QuizID) ON DELETE CASCADE,
  UNIQUE KEY unique_client_attempt (StudentID, QuizID, ClientAttemptUUID),
  INDEX idx_student_quiz (StudentID, QuizID),
  INDEX idx_sync_status (SyncStatus)
);

CREATE TABLE IF NOT EXISTS Responses (
  ResponseID INT PRIMARY KEY AUTO_INCREMENT,
  AttemptID INT NOT NULL,
  QuestionID INT NOT NULL,
  SelectedOptionID INT NULL,
  IsCorrect BOOLEAN NULL,
  FOREIGN KEY (AttemptID) REFERENCES QuizAttempts(AttemptID) ON DELETE CASCADE,
  FOREIGN KEY (QuestionID) REFERENCES Questions(QuestionID) ON DELETE CASCADE,
  FOREIGN KEY (SelectedOptionID) REFERENCES Options(OptionID) ON DELETE SET NULL,
  INDEX idx_attempt (AttemptID),
  INDEX idx_question (QuestionID)
);

-- Powers the Course Progress Summary report: records the first time a
-- student views/downloads each material, so completion % can be computed as
-- (materials viewed + quizzes attempted) / (total materials + total quizzes).
CREATE TABLE IF NOT EXISTS MaterialViews (
  StudentID INT NOT NULL,
  MaterialID INT NOT NULL,
  FirstViewedDate DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (StudentID, MaterialID),
  FOREIGN KEY (StudentID) REFERENCES Users(UserID) ON DELETE CASCADE,
  FOREIGN KEY (MaterialID) REFERENCES Materials(MaterialID) ON DELETE CASCADE
);
