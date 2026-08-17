import { pool } from '../../db/pool.ts';
import { conflict, notFound } from '../../shared/errors.ts';
import * as audit from '../audit/repository.ts';
import * as repository from './repository.ts';
import type { CourseCode } from './repository.ts';

export const listCourseCodes = repository.listCourseCodes;

export async function createCourseCode(value: CourseCode, actorUserId: number, requestId: string) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (await repository.findCourseCode(value.code, connection)) {
      throw conflict('COURSE_CODE_EXISTS', 'This course code already exists.');
    }
    await repository.createCourseCode(value, connection);
    await audit.record({
      actorUserId,
      action: 'course-code.create',
      targetType: 'course-code',
      targetId: value.code,
      after: value,
      requestId,
    }, connection);
    await connection.commit();
    return value;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export async function updateCourseCode(
  code: string,
  value: Pick<CourseCode, 'branch' | 'name'>,
  actorUserId: number,
  requestId: string,
) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const before = await repository.findCourseCode(code, connection);
    if (!before) throw notFound('Course code not found.');
    await repository.updateCourseCode(code, value, connection);
    const after = { code, ...value };
    await audit.record({
      actorUserId,
      action: 'course-code.update',
      targetType: 'course-code',
      targetId: code,
      before,
      after,
      requestId,
    }, connection);
    await connection.commit();
    return after;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export async function deleteCourseCode(code: string, actorUserId: number, requestId: string) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const before = await repository.findCourseCode(code, connection);
    if (!before) throw notFound('Course code not found.');
    await repository.deleteCourseCode(code, connection);
    await audit.record({
      actorUserId,
      action: 'course-code.delete',
      targetType: 'course-code',
      targetId: code,
      before,
      requestId,
    }, connection);
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
