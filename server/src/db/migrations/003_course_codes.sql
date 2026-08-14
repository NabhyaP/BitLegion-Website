-- up
-- Course code → branch mapping, decoded from digits [4..6) of the roll number
-- ('112415119' → '15' → CSE). Admin-editable so a new course never needs a deploy.
CREATE TABLE course_codes (
  code CHAR(2) PRIMARY KEY,
  branch VARCHAR(16) NOT NULL,
  name VARCHAR(100) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO course_codes (code, branch, name) VALUES
  ('15', 'CSE', 'Computer Science and Engineering'),
  ('16', 'ECE', 'Electronics and Communication Engineering');

-- down
DROP TABLE course_codes;
